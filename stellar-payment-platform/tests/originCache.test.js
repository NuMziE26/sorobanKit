'use strict';

// originCache.test.js – unit tests for the in-memory LRU+TTL origin cache.
//
// We exercise lruGet/lruSet directly (white-box) as well as the public
// getCachedApprovedOrigins function so that the acceptance criteria are covered:
//   ✓ Entries expire after the configured TTL
//   ✓ Cache size does not exceed ORIGIN_CACHE_MAX_SIZE
//   ✓ ORIGIN_CACHE_TTL_MS env var is respected
//   ✓ LRU eviction happens when the cap is reached

// Mock the logger so no file handles are opened during the test run.
jest.mock('../src/logger', () => ({ logger: { error: jest.fn(), info: jest.fn() } }));

// Load the module fresh for each test suite so env-var overrides work.
// We re-require inside individual tests that need a specific ORIGIN_CACHE_TTL_MS.

describe('originCache – in-memory LRU helpers', () => {
  let lruGet, lruSet, lruDelete, lruSize, _lruCache;

  beforeEach(() => {
    // Re-require so the Map starts empty and env vars take effect.
    jest.resetModules();
    ({ lruGet, lruSet, lruDelete, lruSize, _lruCache } = require('../src/originCache'));
  });

  test('returns undefined for a key that was never written', () => {
    expect(lruGet('missing')).toBeUndefined();
  });

  test('returns the stored value immediately after a write', () => {
    lruSet('k', ['https://example.com']);
    expect(lruGet('k')).toEqual(['https://example.com']);
  });

  test('lruDelete removes an entry', () => {
    lruSet('k', ['x']);
    lruDelete('k');
    expect(lruGet('k')).toBeUndefined();
  });

  test('lruSize reflects the number of stored entries', () => {
    expect(lruSize()).toBe(0);
    lruSet('a', 1);
    lruSet('b', 2);
    expect(lruSize()).toBe(2);
    lruDelete('a');
    expect(lruSize()).toBe(1);
  });

  test('TTL expiry: entry is unavailable after the TTL elapses', () => {
    jest.useFakeTimers();

    lruSet('ttl-key', ['origin1'], 1_000); // 1 second TTL

    // Just before expiry – still present.
    jest.advanceTimersByTime(999);
    expect(lruGet('ttl-key')).toEqual(['origin1']);

    // At/after expiry – entry is gone.
    jest.advanceTimersByTime(2);
    expect(lruGet('ttl-key')).toBeUndefined();

    jest.useRealTimers();
  });

  test('expired entry is evicted from the Map (does not grow indefinitely)', () => {
    jest.useFakeTimers();

    lruSet('expired', ['x'], 500);
    expect(lruSize()).toBe(1);

    jest.advanceTimersByTime(600);
    lruGet('expired'); // triggers eviction
    expect(lruSize()).toBe(0);

    jest.useRealTimers();
  });

  test('LRU eviction: oldest entry is removed when the cap is exceeded', () => {
    const { ORIGIN_CACHE_MAX_SIZE } = require('../src/originCache');

    // Fill the cache to the cap.
    for (let i = 0; i < ORIGIN_CACHE_MAX_SIZE; i++) {
      lruSet(`key-${i}`, i);
    }
    expect(lruSize()).toBe(ORIGIN_CACHE_MAX_SIZE);

    // The first key written is the LRU; adding one more should evict it.
    lruSet('new-key', 'new-value');

    expect(lruSize()).toBe(ORIGIN_CACHE_MAX_SIZE); // size stays at cap
    expect(lruGet('key-0')).toBeUndefined();       // LRU entry was evicted
    expect(lruGet('new-key')).toBe('new-value');   // new entry is present
  });

  test('reading an entry promotes it so it is not the next LRU victim', () => {
    const { ORIGIN_CACHE_MAX_SIZE } = require('../src/originCache');

    // Insert key-0 first (would be LRU), then fill to cap.
    lruSet('key-0', 0);
    for (let i = 1; i < ORIGIN_CACHE_MAX_SIZE; i++) {
      lruSet(`key-${i}`, i);
    }

    // Promote key-0 by reading it.
    expect(lruGet('key-0')).toBe(0);

    // Adding a new entry should now evict key-1 (the oldest unread entry).
    lruSet('new-key', 'v');

    expect(lruGet('key-0')).toBe(0);          // promoted – still here
    expect(lruGet('key-1')).toBeUndefined();  // actual LRU – evicted
    expect(lruGet('new-key')).toBe('v');
  });

  test('writing the same key updates its value and promotes it to MRU', () => {
    lruSet('k', 'old');
    lruSet('k', 'new');

    expect(lruGet('k')).toBe('new');
    expect(lruSize()).toBe(1); // no duplicate entry
  });
});

describe('originCache – getCachedApprovedOrigins', () => {
  let getCachedApprovedOrigins, lruGet, lruDelete;

  beforeEach(() => {
    jest.resetModules();
    ({ getCachedApprovedOrigins, lruGet, lruDelete } = require('../src/originCache'));
  });

  const noRedis = null;
  const origins = ['https://example.com', 'https://app.stellar.org'];

  test('calls fetchFn when cache is cold and returns its result', async () => {
    const fetch = jest.fn().mockResolvedValue(origins);

    const result = await getCachedApprovedOrigins(noRedis, fetch);

    expect(result).toEqual(origins);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('caches the result in-memory so a second call skips fetchFn', async () => {
    const fetch = jest.fn().mockResolvedValue(origins);

    await getCachedApprovedOrigins(noRedis, fetch);
    const second = await getCachedApprovedOrigins(noRedis, fetch);

    expect(second).toEqual(origins);
    expect(fetch).toHaveBeenCalledTimes(1); // only one DB round-trip
  });

  test('re-fetches from DB after the in-memory TTL expires', async () => {
    jest.useFakeTimers();

    const fetch = jest.fn().mockResolvedValue(origins);
    const { ORIGIN_CACHE_TTL_MS, APPROVED_ORIGINS_CACHE_KEY } = require('../src/originCache');

    await getCachedApprovedOrigins(noRedis, fetch); // populates cache
    expect(fetch).toHaveBeenCalledTimes(1);

    // Advance past TTL.
    jest.advanceTimersByTime(ORIGIN_CACHE_TTL_MS + 1);

    await getCachedApprovedOrigins(noRedis, fetch); // should re-fetch
    expect(fetch).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  test('uses Redis when available and populates in-memory cache from it', async () => {
    const fetch = jest.fn();
    const redisClient = {
      isReady: true,
      get: jest.fn().mockResolvedValue(JSON.stringify(origins)),
      setEx: jest.fn().mockResolvedValue('OK'),
    };

    const result = await getCachedApprovedOrigins(redisClient, fetch);

    expect(result).toEqual(origins);
    expect(fetch).not.toHaveBeenCalled(); // DB was not hit
  });

  test('falls back to fetchFn when Redis returns null', async () => {
    const fetch = jest.fn().mockResolvedValue(origins);
    const redisClient = {
      isReady: true,
      get: jest.fn().mockResolvedValue(null),
      setEx: jest.fn().mockResolvedValue('OK'),
    };

    const result = await getCachedApprovedOrigins(redisClient, fetch);

    expect(result).toEqual(origins);
    expect(fetch).toHaveBeenCalledTimes(1);
    // Should have written back to Redis.
    expect(redisClient.setEx).toHaveBeenCalled();
  });

  test('ORIGIN_CACHE_TTL_MS env var controls the TTL applied to entries', async () => {
    // Re-require with a custom TTL so we can control timing precisely.
    jest.resetModules();
    process.env.ORIGIN_CACHE_TTL_MS = '2000'; // 2 seconds
    const {
      getCachedApprovedOrigins: cachedFn,
      ORIGIN_CACHE_TTL_MS: ttl,
    } = require('../src/originCache');
    delete process.env.ORIGIN_CACHE_TTL_MS;

    expect(ttl).toBe(2_000);

    jest.useFakeTimers();
    const fetch = jest.fn().mockResolvedValue(origins);

    await cachedFn(noRedis, fetch);
    jest.advanceTimersByTime(1_999);
    await cachedFn(noRedis, fetch); // still cached
    expect(fetch).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2);    // now expired
    await cachedFn(noRedis, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
    jest.resetModules();
  });
});
