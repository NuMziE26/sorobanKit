const redis = require('../config/redis');

const CACHE_PREFIX = 'stats:';
const DEFAULT_TTL_SECONDS = 60;

/**
 * Statistics cache backed by Redis so that cached stats are shared across
 * all worker processes in a horizontally scaled deployment.
 *
 * If Redis is unavailable the cache degrades gracefully to a no-op:
 * reads miss and writes are silently dropped, so callers always fall back
 * to computing fresh statistics.
 */
class StatsCache {
  constructor({ client = redis, ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
    this.client = client;
    this.ttlSeconds = ttlSeconds;
  }

  key(key) {
    return `${CACHE_PREFIX}${key}`;
  }

  async get(key) {
    try {
      const value = await this.client.get(this.key(key));
      if (value === null || value === undefined) {
        return null;
      }
      return JSON.parse(value);
    } catch (err) {
      // Redis unavailable or malformed payload: behave as a cache miss.
      return null;
    }
  }

  async set(key, value, ttlSeconds = this.ttlSeconds) {
    try {
      await this.client.set(
        this.key(key),
        JSON.stringify(value),
        'EX',
        ttlSeconds
      );
      return true;
    } catch (err) {
      // Redis unavailable: silently skip caching.
      return false;
    }
  }

  async del(key) {
    try {
      await this.client.del(this.key(key));
      return true;
    } catch (err) {
      return false;
    }
  }

  async clear() {
    try {
      const keys = await this.client.keys(`${CACHE_PREFIX}*`);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return true;
    } catch (err) {
      return false;
    }
  }
}

module.exports = new StatsCache();
module.exports.StatsCache = StatsCache;
