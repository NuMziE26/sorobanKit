// ---------------------------------------------------------------------------
// #52 — SSE Horizon Listener for Real-Time Payment Detection
// ---------------------------------------------------------------------------
// This background service connects to the Stellar Horizon network using
// Server-Sent Events (SSE) to monitor incoming payments for all public keys
// registered in the local federation database.
//
// Usage:
//   npm run listener                  (testnet, default)
//   HORIZON_NETWORK=public npm run listener  (mainnet)
// ---------------------------------------------------------------------------

const { createClient } = require('redis');
const { prisma } = require('./prismaClient');
const { logger } = require('./src/logger');
const { poolGet, poolRun } = require('./src/db');
const {
  dispatchPaymentWebhooks,
  startWebhookWorker,
  closeWebhookQueue,
} = require('./src/webhookWorker');
const {
  horizon,
  createBreaker,
} = require('./src/services/stellarService');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const NETWORK = process.env.HORIZON_NETWORK || 'testnet';

const HORIZON_URLS = {
  testnet: 'https://horizon-testnet.stellar.org',
  public: 'https://horizon.stellar.org',
};

const HORIZON_URL = HORIZON_URLS[NETWORK] || HORIZON_URLS.testnet;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS, 10) || 60000;

// ---------------------------------------------------------------------------
// Redis — cursor persistence
// ---------------------------------------------------------------------------
// The last processed Horizon paging_token is stored under this key so the
// listener can resume exactly where it left off after a restart instead of
// re-starting from "now" and missing events that arrived while it was down.
const CURSOR_KEY = 'horizon:cursor';

const redisClient = process.env.REDIS_URL
  ? createClient({ url: process.env.REDIS_URL })
  : null;

if (redisClient) {
  redisClient.on('error', (err) =>
    logger.error(err, 'Horizon listener — Redis client error'),
  );
}

/**
 * Returns the stored Horizon paging_token, or `'now'` when Redis is
 * unavailable or no cursor has been saved yet.
 *
 * @returns {Promise<string>}
 */
const loadCursor = async () => {
  if (!redisClient) return 'now';
  try {
    const stored = await redisClient.get(CURSOR_KEY);
    if (stored) {
      logger.info(`[horizonListener] Resuming from stored cursor: ${stored}`);
      return stored;
    }
  } catch (err) {
    logger.warn(
      { err },
      '[horizonListener] Could not read cursor from Redis; starting from now',
    );
  }
  return 'now';
};

/**
 * Persists the latest processed Horizon paging_token to Redis.
 * Errors are logged but never surface to the caller — a missed write
 * means the worst case is re-processing a single event after restart.
 *
 * @param {string} pagingToken
 */
const saveCursor = async (pagingToken) => {
  if (!redisClient || !pagingToken) return;
  try {
    await redisClient.set(CURSOR_KEY, pagingToken);
  } catch (err) {
    logger.warn(
      { err, pagingToken },
      '[horizonListener] Could not save cursor to Redis',
    );
  }
};

// ---------------------------------------------------------------------------
// Horizon Health-Check Circuit Breaker
// ---------------------------------------------------------------------------
// Wraps a lightweight Horizon query so we can detect outages fast and avoid
// opening new streams (or polling the DB) while Horizon is unreachable.
const healthCheckBreaker = createBreaker(
  () => horizon.ledgers().latest().call(),
  { timeout: 5000, volumeThreshold: 3 },
);

// ---------------------------------------------------------------------------
// Stream Management
// ---------------------------------------------------------------------------
const activeStreams = new Map();

// ---------------------------------------------------------------------------
// Formatting Helpers
// ---------------------------------------------------------------------------
const timestamp = () => new Date().toISOString();

const formatPayment = (payment, trackedAccount) => {
  const direction = payment.to === trackedAccount ? 'INCOMING' : 'OUTGOING';
  const asset =
    payment.asset_type === 'native'
      ? 'XLM'
      : `${payment.asset_code}:${payment.asset_issuer}`;

  return [
    `[${timestamp()}] 💸 ${direction} PAYMENT DETECTED`,
    `  Account:     ${trackedAccount}`,
    `  From:        ${payment.from}`,
    `  To:          ${payment.to}`,
    `  Amount:      ${payment.amount} ${asset}`,
    `  Tx Hash:     ${payment.transaction_hash}`,
    `  Created:     ${payment.created_at}`,
    '  ─────────────────────────────────────────',
  ].join('\n');
};

// ---------------------------------------------------------------------------
// Stream Management
// ---------------------------------------------------------------------------

/**
 * Open a payment SSE stream for a single Stellar account.
 * On error the stream is removed from the active map so the next sync cycle
 * can attempt to reconnect it (instead of staying stuck on a dead stream).
 *
 * @param {string} accountId  Stellar public key to watch.
 * @param {string} [startCursor='now']  Horizon paging_token to resume from.
 */
const watchAccount = (accountId, startCursor = 'now') => {
  if (activeStreams.has(accountId)) {
    return; // Already watching
  }

  logger.info(`[${timestamp()}] 👁️  Watching payments for ${accountId} (cursor: ${startCursor})`);

  const closeStream = horizon
    .payments()
    .forAccount(accountId)
    .cursor(startCursor)
    .stream({
      onmessage: (payment) => {
        if (payment.type === 'payment' || payment.type_i === 1) {
          logger.info(formatPayment(payment, accountId));

          // Persist the cursor before dispatching so a crash after dispatch
          // doesn't re-deliver the same event on the next restart.
          if (payment.paging_token) {
            saveCursor(payment.paging_token);
          }

          dispatchPaymentWebhooks({
            prisma,
            poolGetFn: poolGet,
            poolRunFn: poolRun,
            payment,
          }).catch((err) =>
            logger.error(
              `[${timestamp()}] ⚠️  Webhook dispatch failed for tx ${payment.transaction_hash}:`,
              err?.message || err,
            ),
          );
        }
      },
      onerror: (error) => {
        logger.error(
          `[${timestamp()}] ⚠️  Stream error for ${accountId}:`,
          error?.message || error,
        );
        // Remove the dead stream so syncWatchedAccounts can re-open it on the
        // next poll cycle instead of leaving a stale entry in the map.
        activeStreams.delete(accountId);
        logger.info(
          `[${timestamp()}] 🔄 Removed dead stream for ${accountId}; will reconnect on next sync`,
        );
      },
    });

  activeStreams.set(accountId, closeStream);
};

/**
 * Query the local database for all registered public keys and open
 * streams for any that aren't already being watched.
 */
const syncWatchedAccounts = async () => {
  // Fast-fail when Horizon is known to be down — don't waste resources
  // opening streams that will immediately error.
  try {
    await healthCheckBreaker.fire();
  } catch {
    logger.warn(
      `[${timestamp()}] ⏸️  Horizon health check failed; skipping stream sync`,
    );
    return;
  }

  try {
    const rows = await prisma.user.findMany({
      distinct: ['address'],
      select: { address: true },
    });

    const currentAddresses = new Set(rows.map((r) => r.address));

    // Load the stored cursor once per sync cycle so newly opened streams
    // resume from the same position as the last processed event.
    const cursor = await loadCursor();

    // Start watching new accounts
    for (const { address } of rows) {
      if (!activeStreams.has(address)) {
        watchAccount(address, cursor);
      }
    }

    // Stop watching removed accounts
    for (const [address, closeFn] of activeStreams) {
      if (!currentAddresses.has(address)) {
        logger.info(`[${timestamp()}] 🛑 Stopped watching removed account ${address}`);
        if (typeof closeFn === 'function') closeFn();
        activeStreams.delete(address);
      }
    }

    logger.info(
      `[${timestamp()}] 📡 Actively monitoring ${activeStreams.size} account(s)`,
    );
  } catch (err) {
    logger.error(`[${timestamp()}] ❌ Failed to sync watched accounts:`, err.message);
  }
};

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------
const shutdown = async () => {
  logger.info(`\n[${timestamp()}] Shutting down Horizon listener...`);
  for (const [address, closeFn] of activeStreams) {
    if (typeof closeFn === 'function') closeFn();
    logger.info(`  Closed stream for ${address}`);
  }
  activeStreams.clear();
  await closeWebhookQueue();
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      // best-effort disconnect
    }
  }
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async () => {
  logger.info('═══════════════════════════════════════════════════════');
  logger.info('  Stellar Horizon Payment Listener');
  logger.info(`  Network:  ${NETWORK.toUpperCase()}`);
  logger.info(`  Horizon:  ${HORIZON_URL}`);
  logger.info(`  Poll:     every ${POLL_INTERVAL_MS / 1000}s for new accounts`);
  logger.info('═══════════════════════════════════════════════════════');

  // Connect to Redis when configured so the cursor can be loaded and saved.
  if (redisClient) {
    try {
      await redisClient.connect();
      logger.info('[horizonListener] Connected to Redis for cursor persistence');
    } catch (err) {
      logger.warn(
        { err },
        '[horizonListener] Redis unavailable — cursor persistence disabled for this run',
      );
    }
  }

  // Initial sync
  await syncWatchedAccounts();

  // Start the durable Redis-backed webhook delivery worker.
  startWebhookWorker({ prisma, poolRunFn: poolRun });

  // Periodically check for newly registered accounts
  setInterval(syncWatchedAccounts, POLL_INTERVAL_MS);
};

main().catch((err) => {
  logger.error('Fatal error starting Horizon listener:', err);
  process.exit(1);
});

// Exported for unit tests only.
module.exports = { loadCursor, saveCursor, CURSOR_KEY, watchAccount, syncWatchedAccounts };
