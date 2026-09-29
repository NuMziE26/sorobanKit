'use strict';

/**
 * tests/register.test.js
 *
 * Tests for POST /register — focuses on the is_primary field behavior (issue #76)
 * and the general registration contract.
 *
 * The existing register-endpoint.test.js covers Express-validator concerns.
 * This file tests the handler logic directly via the /api/v1/register route.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

// Mock verifyMultiSignerThreshold to always succeed so tests focus on is_primary
// logic rather than Horizon connectivity.
jest.mock('../src/multisigner-verifier', () => ({
  verifyMultiSignerThreshold: jest.fn().mockResolvedValue({
    success: true,
    accountId: 'GABC',
    signerCount: 1,
    thresholdMet: true,
    requiredThreshold: 0,
    totalWeight: 1,
    errorMessage: null,
  }),
}));

jest.mock('redis', () => ({ createClient: jest.fn(() => null) }));
jest.mock('../src/cleanup-cron', () => ({ scheduleCleanupJob: jest.fn() }));
jest.mock('../src/soft-delete-purge-cron', () => ({
  scheduleSoftDeletePurgeJob: jest.fn(),
}));

// Prisma mock — individual tests control .count and .create return values.
const mockCount = jest.fn();
const mockCreate = jest.fn();
const mockFindFirst = jest.fn();

jest.mock('../prismaClient', () => ({
  prisma: {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: mockFindFirst,
      count: mockCount,
      create: mockCreate,
      update: jest.fn(),
    },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    activityLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockResolvedValue([0, []]),
    $queryRaw: jest.fn().mockResolvedValue([{ '1': 1 }]),
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

jest.mock('../src/db', () => ({
  poolGet: jest.fn().mockResolvedValue(null),
  poolRun: jest.fn().mockResolvedValue({ changes: 1 }),
  poolAll: jest.fn().mockResolvedValue([]),
  etagCache: (_req, _res, next) => next(),
}));

// Mock activityService so we don't need a real DB for activity recording
jest.mock('../src/services/activityService', () => ({
  ACTIVITY_ACTIONS: { USER_REGISTERED: 'user.registered' },
  recordActivity: jest.fn().mockResolvedValue(undefined),
  listActivity: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
  parseDateRange: jest.fn().mockReturnValue({ range: null, error: null }),
  serializeActivity: jest.fn((r) => r),
}));

jest.mock('pdfkit', () => jest.fn());

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-admin-key';

const request = require('supertest');
const { app } = require('../server');

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_ADDRESS = 'GABC123456789012345678901234567890123456789012345678';
const VALID_ADDRESS_2 = 'GDEF123456789012345678901234567890123456789012345678';

function makeRegisterPayload(overrides = {}) {
  return {
    username: 'alice123',
    address: VALID_ADDRESS,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/register — is_primary field (issue #76)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default: no existing users for the address
    mockCount.mockResolvedValue(0);

    // Default: username not already taken
    mockFindFirst.mockResolvedValue(null);

    // Default: create succeeds
    mockCreate.mockResolvedValue({
      username: 'alice123',
      address: VALID_ADDRESS,
      isPrimary: true,
    });
  });

  // ── Acceptance criterion 1 ──
  it('returns is_primary: true for the first username registered to an address', async () => {
    // No existing usernames for this address
    mockCount.mockResolvedValue(0);
    mockCreate.mockResolvedValue({
      username: 'alice123',
      address: VALID_ADDRESS,
      isPrimary: true,
    });

    const res = await request(app)
      .post('/api/v1/register')
      .set('Content-Type', 'application/json')
      .send(makeRegisterPayload({ username: 'alice123' }));

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.is_primary).toBe(true);
  });

  // ── Acceptance criterion 2 ──
  it('returns is_primary: false for the second username registered to the same address', async () => {
    // Address already has one username registered
    mockCount.mockResolvedValue(1);
    mockCreate.mockResolvedValue({
      username: 'alicepay',
      address: VALID_ADDRESS,
      isPrimary: false,
    });

    const res = await request(app)
      .post('/api/v1/register')
      .set('Content-Type', 'application/json')
      .send(makeRegisterPayload({ username: 'alicepay' }));

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.is_primary).toBe(false);
  });

  it('passes isPrimary=true to prisma.user.create for the first registration', async () => {
    mockCount.mockResolvedValue(0);

    await request(app)
      .post('/api/v1/register')
      .set('Content-Type', 'application/json')
      .send(makeRegisterPayload({ username: 'alice123' }));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isPrimary: true }),
      }),
    );
  });

  it('passes isPrimary=false to prisma.user.create for alias registrations', async () => {
    mockCount.mockResolvedValue(2); // two existing usernames for this address

    await request(app)
      .post('/api/v1/register')
      .set('Content-Type', 'application/json')
      .send(makeRegisterPayload({ username: 'aliceshop' }));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isPrimary: false }),
      }),
    );
  });

  // ── Alias registration sequence ──

  it('registers two usernames for the same address with correct is_primary values in sequence', async () => {
    const address = VALID_ADDRESS;

    // First registration: no existing usernames
    mockCount.mockResolvedValueOnce(0);
    mockCreate.mockResolvedValueOnce({
      username: 'alice123',
      address,
      isPrimary: true,
    });

    const first = await request(app)
      .post('/api/v1/register')
      .set('Content-Type', 'application/json')
      .send({ username: 'alice123', address });

    expect(first.status).toBe(201);
    expect(first.body.is_primary).toBe(true);

    // Second registration: address now has 1 username
    mockCount.mockResolvedValueOnce(1);
    mockCreate.mockResolvedValueOnce({
      username: 'alicepay',
      address,
      isPrimary: false,
    });

    const second = await request(app)
      .post('/api/v1/register')
      .set('Content-Type', 'application/json')
      .send({ username: 'alicepay', address });

    expect(second.status).toBe(201);
    expect(second.body.is_primary).toBe(false);

    // Verify that the prisma count was called both times with the correct address
    expect(mockCount).toHaveBeenCalledTimes(2);
    mockCount.mock.calls.forEach((call) => {
      expect(call[0]).toEqual(
        expect.objectContaining({
          where: expect.objectContaining({ address, deletedAt: null }),
        }),
      );
    });
  });

  it('rejects registration when the address already has the maximum usernames', async () => {
    mockCount.mockResolvedValue(5); // MAX_USERNAMES_PER_ADDRESS = 5

    const res = await request(app)
      .post('/api/v1/register')
      .set('Content-Type', 'application/json')
      .send(makeRegisterPayload({ username: 'alicesixth' }));

    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/register — validation and conflict handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCount.mockResolvedValue(0);
    mockCreate.mockResolvedValue({ username: 'alice123', address: VALID_ADDRESS });
    mockFindFirst.mockResolvedValue(null);
  });

  it('returns 422 when username is missing', async () => {
    const res = await request(app)
      .post('/api/v1/register')
      .set('Content-Type', 'application/json')
      .send({ address: VALID_ADDRESS });

    expect(res.status).toBe(422);
  });

  it('returns 422 when address is missing', async () => {
    const res = await request(app)
      .post('/api/v1/register')
      .set('Content-Type', 'application/json')
      .send({ username: 'alice123' });

    expect(res.status).toBe(422);
  });

  it('returns 415 when Content-Type is not application/json', async () => {
    const res = await request(app)
      .post('/api/v1/register')
      .send('username=alice123&address=' + VALID_ADDRESS);

    expect(res.status).toBe(415);
  });

  it('returns 409 on duplicate username (P2002 Prisma unique constraint)', async () => {
    mockCount.mockResolvedValue(0);
    const conflictErr = new Error('Unique constraint failed on field username');
    conflictErr.code = 'P2002';
    mockCreate.mockRejectedValue(conflictErr);

    const res = await request(app)
      .post('/api/v1/register')
      .set('Content-Type', 'application/json')
      .send(makeRegisterPayload());

    expect(res.status).toBe(409);
  });

  it('returns 400 if a secret key (starts with S) is submitted as address', async () => {
    const res = await request(app)
      .post('/api/v1/register')
      .set('Content-Type', 'application/json')
      .send({ username: 'alice123', address: 'SABC123456789' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Secret Key/i);
  });

  it('returns 200 or 201 and includes username, address, is_primary, federation_address in response', async () => {
    mockCount.mockResolvedValue(0);
    mockCreate.mockResolvedValue({
      username: 'alice123',
      address: VALID_ADDRESS,
      isPrimary: true,
    });

    const res = await request(app)
      .post('/api/v1/register')
      .set('Content-Type', 'application/json')
      .send(makeRegisterPayload());

    expect([200, 201]).toContain(res.status);
    expect(res.body).toMatchObject({
      ok: true,
      username: expect.stringContaining('alice123'),
      address: VALID_ADDRESS,
      is_primary: expect.any(Boolean),
      federation_address: expect.stringContaining('alice123'),
    });
  });
});
