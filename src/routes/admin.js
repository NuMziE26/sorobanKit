const express = require('express');
const router = express.Router();
const { maskIp } = require('../utils');
const { AuditLog } = require('../models');

// GET /admin/audit-logs
router.get('/audit-logs', async (req, res) => {
  try {
    const logs = await AuditLog.findAll({
      order: [['createdAt', 'DESC']],
    });

    const maskedLogs = logs.map((log) => {
      const plain = log.get({ plain: true });
      return {
        ...plain,
        ipAddress: maskIp(plain.ipAddress),
      };
    });

    res.json(maskedLogs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

module.exports = router;
