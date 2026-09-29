/**
 * Shared pagination helper.
 *
 * Computes pagination metadata from a page/pageSize pair and a total count.
 * Prisma `count()` queries can occasionally return unexpected values (e.g. a
 * negative number due to a race condition), so the raw total is clamped to a
 * non-negative value before deriving `totalPages`.
 */

function paginate({ page = 1, pageSize = 10, total = 0 } = {}) {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safePageSize =
    Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 10;

  const rawTotal = Number.isFinite(total) ? total : 0;

  if (rawTotal < 0) {
    console.warn(
      `[pagination] Received negative total (${rawTotal}); clamping to 0.`
    );
  }

  const safeTotal = Math.max(0, rawTotal);
  const totalPages = Math.ceil(safeTotal / safePageSize);

  return {
    page: safePage,
    pageSize: safePageSize,
    total: safeTotal,
    totalPages,
  };
}

module.exports = { paginate };
