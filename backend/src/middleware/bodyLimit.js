'use strict';

const DEFAULT_LIMIT = 10 * 1024; // 10 KB

// Endpoints that stream large payloads and must be exempt from the JSON body cap.
const STREAMING_PATHS = ['/api/export', '/api/stream'];

function isStreamingPath(pathname) {
  return STREAMING_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/')
  );
}

/**
 * Enforces a maximum request body size.
 *
 * Requests that advertise a Content-Length are rejected up front when the
 * declared size exceeds the cap. Requests using Transfer-Encoding: chunked
 * omit Content-Length, so the running byte total is tracked on 'data' events
 * and the request is aborted with 413 once the cap is exceeded.
 */
function bodyLimit(options = {}) {
  const limit = options.limit || DEFAULT_LIMIT;

  return function bodyLimitMiddleware(req, res, next) {
    const pathname = (req.url || '').split('?')[0];

    // Streaming endpoints are exempt from the JSON body cap.
    if (isStreamingPath(pathname)) {
      return next();
    }

    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > limit) {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', limit })
      );
    }

    let received = 0;
    let aborted = false;

    function onData(chunk) {
      if (aborted) {
        return;
      }
      received += chunk.length;
      if (received > limit) {
        aborted = true;
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        res.statusCode = 413;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', limit }));
        if (typeof req.destroy === 'function') {
          req.destroy();
        }
      }
    }

    function onEnd() {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
    }

    req.on('data', onData);
    req.on('end', onEnd);

    return next();
  };
}

module.exports = bodyLimit;
module.exports.DEFAULT_LIMIT = DEFAULT_LIMIT;
