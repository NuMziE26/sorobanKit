'use strict';

const { logger } = require('../logger');

const STATS_CACHE_KEY = 'stats:admin:overview';
// TTL in seconds: honour STATS_CACHE_TTL_MS (ms) when set, fall back to 5 min.
const STATS_CACHE_TTL = process.env.STATS_CACHE_TTL_MS
  ? Math.max(1, Math.floor(Number(process.env.STATS_CACHE_TTL_MS) / 1000))
  : 300;

/**
 * Build a deterministic cache key for the routing-stats endpoint from the
 * query parameters that uniquely identify a result set.
 *
 * @param {object} params
 * @param {string|undefined} params.startDate
 * @param {string|undefined} params.endDate
 * @param {string|undefined} params.groupBy
 * @param {string|undefined} params.assetCode
 * @returns {string} Redis key, e.g. "stats:routing:day:2026-08-01:2026-08-31:XLM"
 */
function buildRoutingStatsCacheKey({ startDate, endDate, groupBy, assetCode } = {}) {
  const parts = [
    'stats:routing',
    groupBy || 'day',
    startDate || '',
    endDate || '',
    assetCode || '',
  ];
  return parts.join(':');
}

/**
 * Attempt to return a cached stats result from Redis.
 * On a cache miss, calls fetchFn(), stores the result in Redis (fire-and-forget),
 * and returns it. If Redis is unavailable or errors, falls through to fetchFn().
 *
 * @param {object|null} redisClient - Redis v4 client, or null if not configured.
 * @param {Function} fetchFn - Async function that returns fresh stats data.
 * @param {object} [opts]
 * @param {string} [opts.key] - Override the cache key (default: STATS_CACHE_KEY).
 * @param {number} [opts.ttl] - Override the TTL in seconds (default: STATS_CACHE_TTL).
 * @returns {Promise<object>} Stats payload.
 */
async function getCachedStats(redisClient, fetchFn, opts = {}) {
  const key = opts.key || STATS_CACHE_KEY;
  const ttl = (opts.ttl !== undefined && opts.ttl !== null) ? opts.ttl : STATS_CACHE_TTL;

  if (redisClient?.isReady) {
    try {
      const cached = await redisClient.get(key);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      logger.warn({ err }, 'Stats cache read failed, falling back to live query');
    }
  }

  const result = await fetchFn();

  if (redisClient?.isReady) {
    redisClient
      .setEx(key, ttl, JSON.stringify(result))
      .catch((err) => logger.warn({ err }, 'Stats cache write failed'));
  }

  return result;
}

/**
 * Delete the stats cache entry from Redis.
 * Logs and swallows any errors so callers are never disrupted.
 *
 * @param {object|null} redisClient - Redis v4 client, or null if not configured.
 * @param {string} [key] - Key to delete (default: STATS_CACHE_KEY).
 */
async function invalidateStatsCache(redisClient, key = STATS_CACHE_KEY) {
  if (!redisClient?.isReady) return;
  try {
    await redisClient.del([key]);
  } catch (err) {
    logger.warn({ err }, 'Stats cache invalidation failed');
  }
}

module.exports = {
  getCachedStats,
  invalidateStatsCache,
  buildRoutingStatsCacheKey,
  STATS_CACHE_KEY,
  STATS_CACHE_TTL,
};
