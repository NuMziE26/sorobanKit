"use strict";

jest.mock("dotenv", () => ({ config: jest.fn() }), { virtual: true });

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: { Server: jest.fn() },
  StrKey: { isValidEd25519PublicKey: jest.fn(() => true) },
  Keypair: { fromPublicKey: jest.fn(() => ({ verify: jest.fn(() => true) })) },
}));

jest.mock("pdfkit", () => jest.fn());
jest.mock("./src/cleanup-cron", () => ({ scheduleCleanupJob: jest.fn() }));
jest.mock("./src/soft-delete-purge-cron", () => ({
  scheduleSoftDeletePurgeJob: jest.fn(),
}));
jest.mock("./src/db-pool-monitor", () => ({
  schedulePoolMonitoring: jest.fn(() => ({ close: jest.fn() })),
}));

jest.mock("bad-words", () =>
  jest.fn().mockImplementation(() => ({
    isProfane: jest.fn(() => false),
  })),
);

jest.mock("./src/db", () => ({
  poolGet: jest.fn(),
  poolRun: jest.fn(),
  poolAll: jest.fn(),
  etagCache: jest.fn((req, res, next) => next()),
}));

jest.mock("./prismaClient", () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
  isPrismaConnectionError: jest.fn(() => false),
}));

jest.mock("./src/multisigner-verifier", () => ({
  verifyMultiSignerThreshold: jest.fn().mockResolvedValue({
    success: true,
    accountId: "GDUMMYACCOUNTIDIIIIIIIIIIIIIIIIIIIIIIIIIIIIII",
    operationType: "management",
    requiredThreshold: 1,
    totalWeight: 1,
    signatureCount: 1,
    uniqueSignerCount: 1,
    signatures: [{ publicKey: "GDUMMY", weight: 1, isValid: true }],
    thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
    signerCount: 1,
    errorMessage: null,
  }),
  isSingleSignerAccount: jest.fn().mockReturnValue(true),
}));

const request = require("supertest");

jest.setTimeout(15000);

describe("soft-delete lookup guards", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("legacy SQLite address lookup excludes soft-deleted records", async () => {
    const { prisma } = require("./prismaClient");
    const { poolGet } = require("./src/db");
    const { app } = require("./server");

    const address = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    prisma.user.findFirst.mockRejectedValue(
      Object.assign(new Error("DB down"), { code: "P2021" }),
    );
    poolGet.mockResolvedValue({ username: "alice", address });

    const response = await request(app).get("/lookup").query({ address });

    expect(response.status).toBe(200);
    expect(poolGet).toHaveBeenCalledWith(
      expect.stringContaining("deleted_at IS NULL"),
      [address],
    );
  });
});

describe("soft-delete federation guard", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  const address = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
  const users = [
    { username: "deleted_user*example.com", address, deletedAt: new Date() },
    { username: "active_user*example.com", address, deletedAt: null },
  ];
  const findFirstFromTable = ({ where }) =>
    Promise.resolve(
      users.find(
        (u) =>
          u.username === String(where.username).split("*")[0] &&
          (where.deletedAt !== null || u.deletedAt === null),
      ) || null,
    );

  test("GET /federation returns 404 for a soft-deleted user", async () => {
    const { prisma } = require("./prismaClient");
    const { app } = require("./server");
    prisma.user.findFirst.mockImplementation(findFirstFromTable);

    const response = await request(app)
      .get("/federation")
      .query({ q: "deleted_user*example.com", type: "name" });

    expect(response.status).toBe(404);
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
  });
});
