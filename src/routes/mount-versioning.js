'use strict';

/**
 * API versioning mount point.
 *
 * Mounts each supported API version under its own prefix. Only routes that
 * actually exist on disk are registered, so the versioning infrastructure
 * stays in sync with the route tree.
 */

const express = require('express');

const v1Federation = require('./federation');
const v2Federation = require('./v2/federation');

const router = express.Router();

// v1 API (deprecated — see src/routes/federation.js)
router.use('/v1/federation', v1Federation);

// v2 API
router.use('/v2/federation', v2Federation);

module.exports = router;
