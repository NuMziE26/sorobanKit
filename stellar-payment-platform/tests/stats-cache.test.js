'use strict';

/**
 * tests/stats-cache.test.js
 *
 * Unit tests for src/cache/statsCache.js.
 *
 * Integration-level cache tests (confirming the /admin/stats/routing handler
 * actually uses the cache) live in tests/admin-stats-routing.test.js alongside
 * the other routing-stats HTTP tests, because that file sets up the Express app
 * without conflicting logger mocks.
 */

jest.mock('../src/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

const { logger } = require('../src/logger');
const {
  getCachedStats,
  invalidateStatsCache,
  buildRoutingStatsCacheKey,
  STATS_CACHE_KEY,
  STATS_CACHE_TTL,
} = require('../src/cache/statsCache');

// ── getCachedStats ────────────────────────────────────────────────────────────

describe('getCachedStats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a cached result when Redis is ready (cache HIT)', async () => {
    const redis = {
      isReady: true,
      get: jest.fn().mockResolvedValue(JSON.stringify({ total: 42 })),
      setEx: jest.fn(),
    };
    const fetchFn = jest.fn();

    const result = await getCachedStats(redis, fetchFn);

    expect(result).toEqual({ total: 42 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches and stores on a cache miss', async () => {
    const redis = {
      isReady: true,
      get: jest.fn().mockResolvedValue(null),
      setEx: jest.fn().mockResolvedValue('OK'),
    };
    const fetchFn = jest.fn().mockResolvedValue({ total: 42 });

    const result = await getCachedStats(redis, fetchFn);

    expect(result).toEqual({ total: 42 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await Promise.resolve(); // fire-and-forget tick
    expect(redis.setEx).toHaveBeenCalledWith(
      STATS_CACHE_KEY,
      STATS_CACHE_TTL,
      JSON.stringify({ total: 42 }),
    );
  });

  it('falls through to fetchFn when Redis client is null', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ total: 1 });
    const result = await getCachedStats(null, fetchFn);
    expect(result).toEqual({ total: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('falls through to fetchFn when Redis is not ready', async () => {
    const redis = { isReady: false, get: jest.fn(), setEx: jest.fn() };
    const fetchFn = jest.fn().mockResolvedValue({ total: 2 });
    const result = await getCachedStats(redis, fetchFn);
    expect(result).toEqual({ total: 2 });
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.setEx).not.toHaveBeenCalled();
  });

  it('logs and falls through when the Redis GET throws', async () => {
    const redis = {
      isReady: true,
      get: jest.fn().mockRejectedValue(new Error('read error')),
      setEx: jest.fn().mockResolvedValue('OK'),
    };
    const fetchFn = jest.fn().mockResolvedValue({ total: 3 });

    const result = await getCachedStats(redis, fetchFn);

    expect(result).toEqual({ total: 3 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('logs a write failure without rejecting', async () => {
    const redis = {
      isReady: true,
      get: jest.fn().mockResolvedValue(null),
      setEx: jest.fn().mockRejectedValue(new Error('write error')),
    };
    const fetchFn = jest.fn().mockResolvedValue({ total: 5 });

    const result = await getCachedStats(redis, fetchFn);

    expect(result).toEqual({ total: 5 });
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalled();
  });

  // ── Custom key ──

  it('uses a custom opts.key when provided', async () => {
    const customKey = 'stats:routing:day:::';
    const redis = {
      isReady: true,
      get: jest.fn().mockResolvedValue(null),
      setEx: jest.fn().mockResolvedValue('OK'),
    };
    const fetchFn = jest.fn().mockResolvedValue({ data: [] });

    await getCachedStats(redis, fetchFn, { key: customKey });

    await Promise.resolve();
    expect(redis.get).toHaveBeenCalledWith(customKey);
    expect(redis.setEx).toHaveBeenCalledWith(
      customKey,
      STATS_CACHE_TTL,
      JSON.stringify({ data: [] }),
    );
  });

  // ── Custom TTL ──

  it('uses a custom opts.ttl when provided', async () => {
    const redis = {
      isReady: true,
      get: jest.fn().mockResolvedValue(null),
      setEx: jest.fn().mockResolvedValue('OK'),
    };
    const fetchFn = jest.fn().mockResolvedValue({ data: [] });

    await getCachedStats(redis, fetchFn, { ttl: 60 });

    await Promise.resolve();
    expect(redis.setEx).toHaveBeenCalledWith(
      STATS_CACHE_KEY,
      60,
      expect.any(String),
    );
  });

  // ── Cache hit/miss behavior ──

  it('serves from cache on second call with the same key (DB not queried again)', async () => {
    const payload = {
      interval: 'day',
      startDate: null,
      endDate: null,
      summary: { total_volume: 0, total_fees: 0, total_count: 0 },
      data: [],
    };

    const redis = {
      isReady: true,
      // First call: miss; second call: hit
      get: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(JSON.stringify(payload)),
      setEx: jest.fn().mockResolvedValue('OK'),
    };
    const fetchFn = jest.fn().mockResolvedValue(payload);
    const customKey = 'stats:routing:day:2026-08-01:2026-08-31:';

    // First request — cache miss, fetchFn invoked
    const first = await getCachedStats(redis, fetchFn, { key: customKey });
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(first).toEqual(payload);

    // Second request — cache hit, fetchFn NOT called again
    const second = await getCachedStats(redis, fetchFn, { key: customKey });
    expect(fetchFn).toHaveBeenCalledTimes(1); // unchanged
    expect(second).toEqual(payload);
  });
});

// ── invalidateStatsCache ──────────────────────────────────────────────────────

describe('invalidateStatsCache', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes the default stats key when no key is passed', async () => {
    const redis = { isReady: true, del: jest.fn().mockResolvedValue(1) };
    await invalidateStatsCache(redis);
    expect(redis.del).toHaveBeenCalledWith([STATS_CACHE_KEY]);
  });

  it('deletes a custom key when one is passed', async () => {
    const redis = { isReady: true, del: jest.fn().mockResolvedValue(1) };
    await invalidateStatsCache(redis, 'stats:routing:day:::');
    expect(redis.del).toHaveBeenCalledWith(['stats:routing:day:::']);
  });

  it('is a no-op when Redis is null', async () => {
    await expect(invalidateStatsCache(null)).resolves.toBeUndefined();
  });

  it('is a no-op when Redis is not ready', async () => {
    const redis = { isReady: false, del: jest.fn() };
    await invalidateStatsCache(redis);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('logs and swallows deletion errors', async () => {
    const redis = {
      isReady: true,
      del: jest.fn().mockRejectedValue(new Error('del failed')),
    };
    await expect(invalidateStatsCache(redis)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

// ── buildRoutingStatsCacheKey ─────────────────────────────────────────────────

describe('buildRoutingStatsCacheKey', () => {
  it('builds a key with all params', () => {
    expect(
      buildRoutingStatsCacheKey({
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        groupBy: 'week',
        assetCode: 'USDC',
      }),
    ).toBe('stats:routing:week:2026-08-01:2026-08-31:USDC');
  });

  it('uses empty strings for omitted optional params', () => {
    expect(buildRoutingStatsCacheKey({ groupBy: 'day' })).toBe(
      'stats:routing:day:::',
    );
  });

  it('defaults groupBy to "day" when not provided', () => {
    expect(buildRoutingStatsCacheKey({})).toBe('stats:routing:day:::');
  });

  it('defaults all params to empty strings when called with no args', () => {
    expect(buildRoutingStatsCacheKey()).toBe('stats:routing:day:::');
  });

  it('produces distinct keys for different assetCode values', () => {
    const keyA = buildRoutingStatsCacheKey({ groupBy: 'day', assetCode: 'XLM' });
    const keyB = buildRoutingStatsCacheKey({ groupBy: 'day', assetCode: 'USDC' });
    expect(keyA).not.toBe(keyB);
    expect(keyA).toBe('stats:routing:day:::XLM');
    expect(keyB).toBe('stats:routing:day:::USDC');
  });

  it('produces distinct keys for different groupBy values', () => {
    const keyDay = buildRoutingStatsCacheKey({ groupBy: 'day' });
    const keyWeek = buildRoutingStatsCacheKey({ groupBy: 'week' });
    const keyMonth = buildRoutingStatsCacheKey({ groupBy: 'month' });
    expect(new Set([keyDay, keyWeek, keyMonth]).size).toBe(3);
  });

  it('produces distinct keys for different date ranges', () => {
    const keyAug = buildRoutingStatsCacheKey({
      groupBy: 'month',
      startDate: '2026-08-01',
    });
    const keySep = buildRoutingStatsCacheKey({
      groupBy: 'month',
      startDate: '2026-09-01',
    });
    expect(keyAug).not.toBe(keySep);
  });
});
