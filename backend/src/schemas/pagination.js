const { z } = require('zod');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Shared pagination query schema.
 *
 * Accepts `page` (default 1) and `limit` (default 50, clamped to a max of 100).
 * Values are coerced from query strings and validated as positive integers.
 */
const paginationSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_PAGE),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT),
});

/**
 * Parse pagination query params, clamping `limit` to MAX_LIMIT and
 * falling back to defaults for invalid values.
 *
 * @param {object} [query]
 * @returns {{ page: number, limit: number, offset: number }}
 */
function parsePagination(query = {}) {
  const result = paginationSchema.safeParse(query);

  if (!result.success) {
    const page = Number.parseInt(query.page, 10);
    const limit = Number.parseInt(query.limit, 10);

    return {
      page: Number.isInteger(page) && page > 0 ? page : DEFAULT_PAGE,
      limit:
        Number.isInteger(limit) && limit > 0
          ? Math.min(limit, MAX_LIMIT)
          : DEFAULT_LIMIT,
      offset: 0,
    };
  }

  const { page, limit } = result.data;
  const clampedLimit = Math.min(limit, MAX_LIMIT);

  return {
    page,
    limit: clampedLimit,
    offset: (page - 1) * clampedLimit,
  };
}

/**
 * Build the pagination `meta` block returned alongside `data`.
 *
 * Always includes every meta field so clients can safely read
 * `meta.totalPages` even when there are no results (defaults to 0).
 *
 * @param {{ total: number, page: number, limit: number }} params
 * @returns {{ total: number, page: number, limit: number, totalPages: number }}
 */
function buildPaginationMeta({ total, page, limit }) {
  const safeLimit = limit > 0 ? limit : DEFAULT_LIMIT;
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;

  return {
    total: safeTotal,
    page,
    limit: safeLimit,
    totalPages: Math.ceil(safeTotal / safeLimit) || 0,
  };
}

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  paginationSchema,
  parsePagination,
  buildPaginationMeta,
};
