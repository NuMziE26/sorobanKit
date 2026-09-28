'use strict';

const { ApiError } = require('../errors');
const { logger } = require('../logger');

/**
 * Wraps an async route handler or middleware to catch unhandled promise
 * rejections and pass them to the Express error handler via next(err).
 *
 * If the thrown value is not an Error instance (e.g. a plain string or object),
 * it is wrapped in an ApiError with INTERNAL_ERROR so the error handler always
 * receives a typed error and raw values are never leaked in responses.
 *
 * @param {Function} fn - The async Express handler function
 * @returns {Function} Express middleware/handler function
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => {
    if (err instanceof Error) {
      return next(err);
    }
    // Non-Error throw: log the original value and forward a safe ApiError.
    logger.error(
      { thrownValue: err, correlationId: req.correlationId },
      'asyncHandler caught a non-Error throw; wrapping in ApiError',
    );
    return next(new ApiError('INTERNAL_ERROR', 'An unexpected error occurred'));
  });
};

module.exports = { asyncHandler };
