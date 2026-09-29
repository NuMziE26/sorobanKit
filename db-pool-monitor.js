'use strict';

const logger = require('./logger');

const DB_POOL_WAIT_ALERT = parseInt(process.env.DB_POOL_WAIT_ALERT, 10) || 10;
const CHECK_INTERVAL_MS = parseInt(process.env.DB_POOL_CHECK_INTERVAL_MS, 10) || 5000;

let monitorTimer = null;
let pool = null;

function collectPoolMetrics() {
  if (!pool) {
    return { total: 0, idle: 0, waiting: 0 };
  }

  return {
    total: typeof pool.totalCount === 'number' ? pool.totalCount : 0,
    idle: typeof pool.idleCount === 'number' ? pool.idleCount : 0,
    waiting: typeof pool.waitingCount === 'number' ? pool.waitingCount : 0,
  };
}

function checkWaitQueue() {
  const metrics = collectPoolMetrics();
  const waiting = metrics.waiting;

  if (waiting > 2 * DB_POOL_WAIT_ALERT) {
    logger.error('DB pool wait queue critically high', {
      waiting,
      threshold: DB_POOL_WAIT_ALERT,
    });
  } else if (waiting > DB_POOL_WAIT_ALERT) {
    logger.warn('DB pool wait queue high', { waiting });
  }

  return metrics;
}

function startMonitor(dbPool) {
  pool = dbPool;

  if (monitorTimer) {
    return;
  }

  monitorTimer = setInterval(() => {
    try {
      checkWaitQueue();
    } catch (err) {
      logger.error('DB pool monitor check failed', { error: err.message });
    }
  }, CHECK_INTERVAL_MS);

  if (typeof monitorTimer.unref === 'function') {
    monitorTimer.unref();
  }
}

function stopMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
  pool = null;
}

module.exports = {
  DB_POOL_WAIT_ALERT,
  CHECK_INTERVAL_MS,
  collectPoolMetrics,
  checkWaitQueue,
  startMonitor,
  stopMonitor,
};
