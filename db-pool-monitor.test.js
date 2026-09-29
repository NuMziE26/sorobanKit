const { Pool } = require('pg');
const logger = require('./logger');
const { startPoolMonitor, checkPoolWaitQueue } = require('./db-pool-monitor');

jest.mock('./logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

describe('db-pool-monitor wait queue alerts', () => {
  const originalEnv = process.env.DB_POOL_WAIT_ALERT;

  afterEach(() => {
    jest.clearAllMocks();
    if (originalEnv === undefined) {
      delete process.env.DB_POOL_WAIT_ALERT;
    } else {
      process.env.DB_POOL_WAIT_ALERT = originalEnv;
    }
  });

  function mockPool(waitingQueries) {
    return {
      waitingCount: waitingQueries,
      totalCount: 5,
      idleCount: 2,
    };
  }

  test('logs warn when waitingQueries exceeds default threshold of 10', () => {
    delete process.env.DB_POOL_WAIT_ALERT;
    checkPoolWaitQueue(mockPool(11));

    expect(logger.warn).toHaveBeenCalledWith('DB pool wait queue high', { waiting: 11 });
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('logs error when waitingQueries exceeds 2 * threshold', () => {
    delete process.env.DB_POOL_WAIT_ALERT;
    checkPoolWaitQueue(mockPool(21));

    expect(logger.error).toHaveBeenCalledWith('DB pool wait queue critical', { waiting: 21 });
  });

  test('does not log when waitingQueries is within threshold', () => {
    delete process.env.DB_POOL_WAIT_ALERT;
    checkPoolWaitQueue(mockPool(10));

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('DB_POOL_WAIT_ALERT env var configures the threshold', () => {
    process.env.DB_POOL_WAIT_ALERT = '5';
    checkPoolWaitQueue(mockPool(6));

    expect(logger.warn).toHaveBeenCalledWith('DB pool wait queue high', { waiting: 6 });
  });

  test('startPoolMonitor periodically checks the wait queue', () => {
    jest.useFakeTimers();
    const pool = mockPool(11);
    const stop = startPoolMonitor(pool, 1000);

    jest.advanceTimersByTime(1000);

    expect(logger.warn).toHaveBeenCalledWith('DB pool wait queue high', { waiting: 11 });

    stop();
    jest.useRealTimers();
  });
});
