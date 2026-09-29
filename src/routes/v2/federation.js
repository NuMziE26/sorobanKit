'use strict';

/**
 * v2 Federation routes.
 *
 * This is the initial scaffold for the v2 API surface. The v1 federation
 * route (`src/routes/federation.js`) is deprecated and will be removed in a
 * future release; new integrations should target this v2 route.
 */

const express = require('express');

const router = express.Router();

/**
 * GET /v2/federation
 *
 * Returns basic federation metadata for the v2 API surface.
 */
router.get('/', (req, res) => {
  res.json({
    version: 'v2',
    status: 'ok',
    deprecated: false,
  });
});

module.exports = router;
