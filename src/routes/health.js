const express = require('express');
const router = express.Router();
const db = require('../db');
const poolMonitor = require('../db-pool-monitor');

const POOL_WARN_THRESHOLD = Number(process.env.POOL_WARN_THRESHOLD ?? 5);

router.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    database: 'unknown',
    pool: {
      waitingQueries: 0,
      threshold: POOL_WARN_THRESHOLD,
    },
  };

  try {
    await db.query('SELECT 1');
    health.database = 'ok';
  } catch (err) {
    health.status = 'error';
    health.database = 'unreachable';
    return res.status(503).json(health);
  }

  const waitingQueries = poolMonitor.getMetric('db_pool_queries_waiting');
  health.pool.waitingQueries = waitingQueries;

  if (waitingQueries > POOL_WARN_THRESHOLD) {
    health.status = 'error';
    health.pool.saturated = true;
    return res.status(503).json(health);
  }

  return res.status(200).json(health);
});

module.exports = router;
