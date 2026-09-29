const errorHandler = require('./errorHandler');

const createRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('errorHandler', () => {
  let logger;

  beforeEach(() => {
    logger = {
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  it('logs a 4xx error at warn level with its correlationId', () => {
    const err = new Error('Not Found');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    err.correlationId = 'corr-404';

    const req = {};
    const res = createRes();

    errorHandler(logger)(err, req, res, jest.fn());

    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        correlationId: 'corr-404',
        statusCode: 404,
        code: 'NOT_FOUND',
      })
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a 5xx error at error level with stack and correlationId', () => {
    const err = new Error('Boom');
    err.statusCode = 500;
    err.code = 'INTERNAL_ERROR';
    err.correlationId = 'corr-500';

    const req = {};
    const res = createRes();

    errorHandler(logger)(err, req, res, jest.fn());

    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        correlationId: 'corr-500',
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        stack: err.stack,
      })
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
