'use strict';

const logger = require('../utils/logger');

/**
 * Centralized error handler middleware.
 *
 * Attaches a correlation id to every error response and logs the error
 * with the appropriate severity: `warn` for client (4xx) errors and
 * `error` for server (5xx) errors.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const correlationId = req.correlationId || req.id || err.correlationId;

  const meta = { correlationId, statusCode, code };

  if (statusCode >= 500) {
    logger.error(err.message, { ...meta, stack: err.stack });
  } else {
    logger.warn(err.message, meta);
  }

  const body = {
    error: {
      message: err.message || 'Internal Server Error',
      code,
    },
  };

  if (statusCode >= 500) {
    body.error.reference_id = correlationId;
  } else {
    body.error.correlation_id = correlationId;
  }

  res.status(statusCode).json(body);
}

module.exports = errorHandler;
