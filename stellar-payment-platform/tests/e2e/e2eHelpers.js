'use strict';

const { randomUUID } = require('crypto');

// Prefix shared by every record an e2e suite creates. The random suffix scopes
// records to a single run so cleanup never touches another run's data.
// Alphanumeric only and short enough to pass username validation (3-20 chars).
function e2ePrefix() {
  return `e2etest${randomUUID().replace(/-/g, '').slice(0, 6)}`;
}

// Delete every record in `store` whose username starts with `prefix`.
function purgeTestRecords(store, prefix) {
  for (const [key, row] of store.entries()) {
    if (row && typeof row.username === 'string' && row.username.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

module.exports = { e2ePrefix, purgeTestRecords };
