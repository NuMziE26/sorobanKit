const { paginate } = require('./pagination');

describe('paginate', () => {
  it('computes totalPages from total and limit', () => {
    const result = paginate({ total: 42, limit: 10, page: 1 });
    expect(result.total).toBe(42);
    expect(result.totalPages).toBe(5);
  });

  it('clamps negative totals to zero', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = paginate({ total: -5, limit: 10, page: 1 });
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('handles a zero total', () => {
    const result = paginate({ total: 0, limit: 10, page: 1 });
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });
});
