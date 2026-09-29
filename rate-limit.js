'use strict';

const crypto = require('crypto');

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000;
const RATE_LIMIT_AUTHENTICATED =
  parseInt(process.env.RATE_LIMIT_AUTHENTICATED, 10) || 1000;
const RATE_LIMIT_ANONYMOUS =
  parseInt(process.env.RATE_LIMIT_ANONYMOUS, 10) || 100;

const buckets = new Map();

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

function getClientKey(req) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && typeof apiKey === 'string' && apiKey.trim() !== '') {
    return { key: `auth:${hashApiKey(apiKey.trim())}`, limit: RATE_LIMIT_AUTHENTICATED };
  }
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  return { key: `anon:${ip}`, limit: RATE_LIMIT_ANONYMOUS };
}

function rateLimit(req, res, next) {
  const now = Date.now();
  const { key, limit } = getClientKey(req);

  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  const remaining = Math.max(0, limit - bucket.count);
  const resetMs = bucket.start + WINDOW_MS - now;

  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil((bucket.start + WINDOW_MS) / 1000)));

  if (bucket.count > limit) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(resetMs / 1000))));
    return res.status(429).json({ error: 'Too Many Requests' });
  }

  return next();
}

module.exports = rateLimit;
module.exports.rateLimit = rateLimit;
module.exports.getClientKey = getClientKey;
module.exports.hashApiKey = hashApiKey;
module.exports.RATE_LIMIT_AUTHENTICATED = RATE_LIMIT_AUTHENTICATED;
module.exports.RATE_LIMIT_ANONYMOUS = RATE_LIMIT_ANONYMOUS;
module.exports.WINDOW_MS = WINDOW_MS;
