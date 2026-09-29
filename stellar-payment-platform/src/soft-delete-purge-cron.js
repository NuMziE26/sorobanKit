'use strict';

const cron = require('node-cron');
const { logger } = require('./logger');

/**
 * Days after soft-delete before a user row is permanently removed.
 *
 * Configurable via the PURGE_RETENTION_DAYS environment variable so operators
 * on regulated platforms can extend retention for compliance (e.g. 90 or 365
 * days) without code changes.
 *
 * Defaults to 30 days. Values that are not positive integers are rejected at
 * startup to prevent silent misconfiguration.
 */
const _rawRetention = process.env.PURGE_RETENTION_DAYS;
const SOFT_DELETE_RETENTION_DAYS = (() => {
  if (_rawRetention === undefined || _rawRetention === '') return 30;
  const parsed = parseInt(_rawRetention, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `PURGE_RETENTION_DAYS must be a positive integer, got: "${_rawRetention}"`,
    );
  }
  return parsed;
})();

logger.info(`[soft-delete-purge] Retention window: ${SOFT_DELETE_RETENTION_DAYS} day(s)`);

/**
 * Permanently deletes user rows whose soft-delete timestamp is older than
 * {@link SOFT_DELETE_RETENTION_DAYS} days.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<number>} Number of purged records.
 */
async function runSoftDeletePurge(prisma) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SOFT_DELETE_RETENTION_DAYS);

  const result = await prisma.user.deleteMany({
    where: {
      deletedAt: { lt: cutoff },
    },
  });

  return result.count;
}

/**
 * Schedules a daily midnight cron job that purges expired soft-deleted users.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 */
function scheduleSoftDeletePurgeJob(prisma) {
  cron.schedule('0 0 * * *', async () => {
    logger.info('[soft-delete-purge] Starting soft-delete purge…');
    try {
      const purged = await runSoftDeletePurge(prisma);
      logger.info('[soft-delete-purge] Soft-delete purge complete', { purged });
    } catch (err) {
      logger.error('[soft-delete-purge] Soft-delete purge failed', { err: err.message });
    }
  });

  logger.info('[soft-delete-purge] Daily soft-delete purge job scheduled (midnight)');
}

module.exports = {
  scheduleSoftDeletePurgeJob,
  runSoftDeletePurge,
  SOFT_DELETE_RETENTION_DAYS,
};
