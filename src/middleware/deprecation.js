const { logger } = require('../logger');

/**
 * Middleware that marks deprecated endpoints by setting the standard
 * `Deprecation` and `Sunset` response headers, and logs a warning whenever a
 * deprecated endpoint is actually called so adoption can be measured.
 *
 * @param {Object} options
 * @param {string} [options.sunset] - HTTP date when the endpoint will be removed.
 * @param {string} [options.link] - Link header value pointing to deprecation docs.
 * @returns {import('express').RequestHandler}
 */
function deprecation({ sunset, link } = {}) {
  return function deprecationMiddleware(req, res, next) {
    res.setHeader('Deprecation', 'true');

    if (sunset) {
      res.setHeader('Sunset', sunset);
    }

    if (link) {
      res.setHeader('Link', link);
    }

    logger.warn('Deprecated endpoint called', {
      route: req.originalUrl || req.url,
      correlationId: req.correlationId || req.id,
    });

    next();
  };
}

module.exports = deprecation;
module.exports.deprecation = deprecation;
