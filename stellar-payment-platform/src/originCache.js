'use strict';

const { logger } = require('./logger');

// ── Redis constants ──────────────────────────────────────────────────────────

const APPROVED_ORIGINS_CACHE_TTL = 300; // seconds – for Redis setEx
const APPROVED_ORIGINS_CACHE_KEY = 'cors:approved-origins';

// ── In-memory LRU + TTL cache ─────────────────────────────────────────────────
//
// Goals:
//   • Entries expire after ORIGIN_CACHE_TTL_MS milliseconds (default 5 min).
//   • At most ORIGIN_CACHE_MAX_SIZE entries are kept (default 1 000).
//   • Least-recently-used entries are evicted once the size cap is reached.
//
// Implementation notes:
//   A plain JS Map preserves insertion order, so LRU is achieved by:
//     1. On read  – delete the key then re-insert it (moves it to "newest").
//     2. On write – evict the first (oldest) key when the cap is exceeded.
//
// The TTL is stored per-entry as an expiry timestamp alongside the value.

const ORIGIN_CACHE_TTL_MS =
  Number(process.env.ORIGIN_CACHE_TTL_MS) || 5 * 60 * 1_000; // 5 minutes
const ORIGIN_CACHE_MAX_SIZE = 1_000;

// Each Map value is { value: <data>, expiresAt: <epoch ms> }.
const _lruCache = new Map();

/**
 * Read a cache entry. Returns the stored value if present and not expired,
 * otherwise returns `undefined` and evicts the stale entry.
 *
 * @param {string} key
 * @returns {*|undefined}
 */
const lruGet = (key) => {
  const entry = _lruCache.get(key);
  if (!entry) return undefined;

  if (Date.now() > entry.expiresAt) {
    _lruCache.delete(key);
    return undefined;
  }

  // Promote to most-recently-used by re-inserting at the tail of the Map.
  _lruCache.delete(key);
  _lruCache.set(key, entry);

  return entry.value;
};

/**
 * Write a cache entry with a TTL and enforce the maximum-size cap.
 *
 * @param {string} key
 * @param {*}      value
 * @param {number} [ttlMs]  TTL in milliseconds. Defaults to ORIGIN_CACHE_TTL_MS.
 */
const lruSet = (key, value, ttlMs = ORIGIN_CACHE_TTL_MS) => {
  // Remove the existing entry (if any) so the re-insert goes to the tail.
  _lruCache.delete(key);

  // Evict the LRU entry (first key in Map iteration order) if at the cap.
  if (_lruCache.size >= ORIGIN_CACHE_MAX_SIZE) {
    const lruKey = _lruCache.keys().next().value;
    _lruCache.delete(lruKey);
  }

  _lruCache.set(key, { value, expiresAt: Date.now() + ttlMs });
};

/**
 * Remove a single entry from the in-memory cache.
 * @param {string} key
 */
const lruDelete = (key) => _lruCache.delete(key);

/**
 * Current number of entries in the in-memory cache (including unexpired ones).
 * Primarily useful for testing.
 */
const lruSize = () => _lruCache.size;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retrieve the list of approved CORS origins.
 *
 * Lookup order:
 *   1. In-memory LRU+TTL cache  (fastest, bounded to ORIGIN_CACHE_MAX_SIZE)
 *   2. Redis                    (shared, survives restarts)
 *   3. `fetchFn`                (database)
 *
 * The result is written back to every layer that was missed.
 *
 * @param {import('redis').RedisClientType|null} redisClient
 * @param {() => Promise<string[]>}              fetchFn
 * @returns {Promise<string[]>}
 */
async function getCachedApprovedOrigins(redisClient, fetchFn) {
  // 1. In-memory LRU hit.
  const memHit = lruGet(APPROVED_ORIGINS_CACHE_KEY);
  if (memHit !== undefined) return memHit;

  // 2. Redis hit.
  if (redisClient && redisClient.isReady) {
    try {
      const cached = await redisClient.get(APPROVED_ORIGINS_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Populate the in-memory cache so the next hit is local.
        lruSet(APPROVED_ORIGINS_CACHE_KEY, parsed);
        return parsed;
      }
    } catch (err) {
      logger.error('Error reading approved origins cache from Redis:', err);
    }
  }

  // 3. Database fetch.
  const result = await fetchFn();

  if (result !== null) {
    // Write back to both layers.
    lruSet(APPROVED_ORIGINS_CACHE_KEY, result);

    if (redisClient && redisClient.isReady) {
      redisClient
        .setEx(APPROVED_ORIGINS_CACHE_KEY, APPROVED_ORIGINS_CACHE_TTL, JSON.stringify(result))
        .catch((err) => logger.error('Error saving approved origins cache to Redis:', err));
    }
  }

  return result;
}

module.exports = {
  APPROVED_ORIGINS_CACHE_TTL,
  APPROVED_ORIGINS_CACHE_KEY,
  ORIGIN_CACHE_TTL_MS,
  ORIGIN_CACHE_MAX_SIZE,
  getCachedApprovedOrigins,
  // Exported for testing only:
  lruGet,
  lruSet,
  lruDelete,
  lruSize,
  _lruCache,
};
