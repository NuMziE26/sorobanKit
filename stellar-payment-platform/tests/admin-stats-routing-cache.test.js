'use strict';

/**
 * tests/admin-stats-routing-cache.test.js
 *
 * Integration tests verifying that GET /admin/stats/routing uses Redis to cache
 * results (issue #75):
 *  - cache miss → DB queried, result stored in Redis
 *  - cache hit  → DB NOT queried, cached value returned
 *  - different query params → different cache keys
 *
 * REDIS_URL must be set so the server creates the Redis client (server.js only
 * creates one when REDIS_URL is defined). We set it to a dummy value and mock
 * the entire `redis` module so no real connection is made.
 */

// Set REDIS_URL BEFORE any requires so server.js calls createClient.
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-admin-key';

// ── Spy on Redis ──────────────────────────────────────────────────────────────

const mockRedisGet = jest.fn();
const mockRedisSetEx = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);

const mockRedisClient = {
  isReady: true,
  get: mockRedisGet,
  setEx: mockRedisSetEx,
  del: mockRedisDel,
  on: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  sendCommand: jest.fn(),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

// ── Other mocks ───────────────────────────────────────────────────────────────

jest.mock('../src/cleanup-cron', () => ({ scheduleCleanupJob: jest.fn() }));
jest.mock('../src/soft-delete-purge-cron', () => ({
  scheduleSoftDeletePurgeJob: jest.fn(),
}));

const mockFindMany = jest.fn();

jest.mock('../prismaClient', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      findMany: mockFindMany,
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockResolvedValue([0, []]),
    $queryRaw: jest.fn().mockResolvedValue([]),
    $metrics: {
      json: jest.fn().mockResolvedValue({
        counters: [],
        gauges: [],
        histograms: [],
      }),
    },
  },
  isPrismaConnectionError: () => false,
}));

jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({ payments: jest.fn() })),
  },
  StrKey: {
    isValidEd25519PublicKey: jest.fn(
      (v) => typeof v === 'string' && v.startsWith('G'),
    ),
  },
  Keypair: {
    fromPublicKey: jest.fn(() => ({ verify: jest.fn(() => true) })),
  },
}));

jest.mock('pdfkit', () => jest.fn());

// rate-limit-redis exports { RedisStore } — mock it as a constructable class
// implementing the express-rate-limit Store interface (increment/decrement/resetKey)
jest.mock('rate-limit-redis', () => {
  const RedisStore = jest.fn().mockImplementation(() => ({
    increment: jest.fn().mockResolvedValue({ totalHits: 1, resetTime: new Date() }),
    decrement: jest.fn().mockResolvedValue(undefined),
    resetKey: jest.fn().mockResolvedValue(undefined),
    sendCommand: jest.fn(),
  }));
  return { RedisStore };
});

const request = require('supertest');
const { app } = require('../server');
const { STATS_CACHE_TTL } = require('../src/cache/statsCache');

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTH = { 'x-api-key': 'test-admin-key' };

// Serialised empty stats payload matching what getRoutingStats returns
const emptyStatsPayload = JSON.stringify({
  interval: 'day',
  startDate: null,
  endDate: null,
  summary: { total_volume: 0, total_fees: 0, total_count: 0 },
  data: [],
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /admin/stats/routing — cache behaviour (issue #75)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.isReady = true;
    mockFindMany.mockResolvedValue([]);
    mockRedisGet.mockResolvedValue(null); // default: cache miss
    mockRedisSetEx.mockResolvedValue('OK');
  });

  it('queries the DB on the first request when the cache is cold', async () => {
    mockRedisGet.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/v1/admin/stats/routing')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it('stores the result in Redis after a cache miss', async () => {
    mockRedisGet.mockResolvedValueOnce(null);

    await request(app)
      .get('/api/v1/admin/stats/routing')
      .set(AUTH);

    // fire-and-forget flush
    await new Promise((r) => setImmediate(r));

    expect(mockRedisSetEx).toHaveBeenCalledWith(
      expect.stringMatching(/^stats:routing:/),
      STATS_CACHE_TTL,
      expect.any(String),
    );
  });

  it('does NOT query the DB on a second identical request (cache HIT)', async () => {
    // Both requests hit the cache
    mockRedisGet.mockResolvedValue(emptyStatsPayload);

    const res1 = await request(app)
      .get('/api/v1/admin/stats/routing')
      .set(AUTH);

    const res2 = await request(app)
      .get('/api/v1/admin/stats/routing')
      .set(AUTH);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // DB was never called — both responses came from cache
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('uses different cache keys for different groupBy values', async () => {
    mockRedisGet.mockResolvedValue(null); // always miss

    await request(app)
      .get('/api/v1/admin/stats/routing?groupBy=day')
      .set(AUTH);

    await request(app)
      .get('/api/v1/admin/stats/routing?groupBy=month')
      .set(AUTH);

    await new Promise((r) => setImmediate(r));

    const keys = mockRedisSetEx.mock.calls.map((c) => c[0]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toContain('day');
    expect(keys[1]).toContain('month');
  });

  it('uses different cache keys for different assetCode values', async () => {
    mockRedisGet.mockResolvedValue(null); // always miss

    await request(app)
      .get('/api/v1/admin/stats/routing?assetCode=XLM')
      .set(AUTH);

    await request(app)
      .get('/api/v1/admin/stats/routing?assetCode=USDC')
      .set(AUTH);

    await new Promise((r) => setImmediate(r));

    const keys = mockRedisSetEx.mock.calls.map((c) => c[0]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toContain('XLM');
    expect(keys[1]).toContain('USDC');
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('uses different cache keys for different date ranges', async () => {
    mockRedisGet.mockResolvedValue(null);

    await request(app)
      .get('/api/v1/admin/stats/routing?startDate=2026-08-01&endDate=2026-08-31')
      .set(AUTH);

    await request(app)
      .get('/api/v1/admin/stats/routing?startDate=2026-07-01&endDate=2026-07-31')
      .set(AUTH);

    await new Promise((r) => setImmediate(r));

    const keys = mockRedisSetEx.mock.calls.map((c) => c[0]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toContain('2026-08-01');
    expect(keys[1]).toContain('2026-07-01');
  });

  it('falls back to the DB and returns correct data when Redis is unavailable', async () => {
    mockRedisClient.isReady = false;

    const records = [
      {
        id: '1',
        createdAt: new Date('2026-08-10T10:00:00Z'),
        amount: 200,
        fee: 2,
        assetCode: 'XLM',
        status: 'completed',
      },
    ];
    mockFindMany.mockResolvedValueOnce(records);

    const res = await request(app)
      .get('/api/v1/admin/stats/routing')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.summary.total_count).toBe(1);
    expect(res.body.summary.total_volume).toBe(200);

    mockRedisClient.isReady = true;
  });
});
