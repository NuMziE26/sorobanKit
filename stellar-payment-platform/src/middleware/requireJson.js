'use strict';

const { ApiError } = require('../errors');

/**
 * Rejects requests whose Content-Type is not application/json.
 *
 * Uses Express's req.is() which performs proper MIME-type matching (including
 * parameters like charset). This blocks text/plain, application/x-www-form-
 * urlencoded, and multipart bodies — all common CSRF-exploit vectors that send
 * JSON payloads under a non-JSON content type.
 *
 * Without this guard, every field in the body would be reported as missing,
 * masking the real problem behind a list of spurious field errors.
 */
const requireJson = (req, res, next) => {
  if (!req.is('application/json')) {
    return next(
      new ApiError(
        'UNSUPPORTED_MEDIA_TYPE',
        'Unsupported Media Type. Content-Type must be application/json',
      ),
    );
  }
  return next();
};

module.exports = { requireJson };
