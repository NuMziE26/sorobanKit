'use strict';

/**
 * src/middleware/security.js
 *
 * Security headers middleware configured with strict Content Security Policy (CSP)
 * to deny all framing, restrict script/style sources, and remove identifying headers.
 *
 * A Permissions-Policy header is also set to disable browser APIs that this
 * application never needs (camera, microphone, geolocation), preventing
 * accidental capability grant to third-party scripts.
 */

const helmet = require('helmet');

const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:', 'https:'],
  fontSrc: ["'self'"],
  objectSrc: ["'none'"],
  mediaSrc: ["'self'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
};

/**
 * Permissions-Policy value applied to every response.
 *
 * Each directive uses an empty allowlist `()` which means the feature is
 * blocked for this origin and all embedded frames — no page served by this
 * API may access the camera, microphone, or geolocation APIs.
 *
 * Extend this string if a future feature legitimately needs a browser
 * permission (e.g. payment handlers), but keep the default posture as
 * restrictive as possible.
 */
const permissionsPolicy = 'camera=(), microphone=(), geolocation=()';

const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: cspDirectives,
  },
  frameguard: {
    action: 'deny',
  },
  hidePoweredBy: true,
  referrerPolicy: {
    policy: 'no-referrer',
  },
  xContentTypeOptions: true,
});

/**
 * Composed security middleware that applies Helmet headers and then sets
 * the Permissions-Policy header.
 *
 * Using a single function keeps the call-site (`app.use(securityMiddleware)`)
 * unchanged while ensuring both steps always run together.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const securityMiddleware = (req, res, next) => {
  helmetMiddleware(req, res, (err) => {
    if (err) return next(err);
    res.setHeader('Permissions-Policy', permissionsPolicy);
    next();
  });
};

module.exports = {
  securityMiddleware,
  cspDirectives,
  permissionsPolicy,
};
