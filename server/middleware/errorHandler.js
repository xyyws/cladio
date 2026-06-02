/**
 * 全局错误处理中间件
 */
function errorHandler(err, _req, res, _next) {
  console.error('[Claudio Error]', err.message);
  console.error(err.stack);

  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    error: {
      message: err.message || 'Internal Server Error',
      code: err.code || 'UNKNOWN_ERROR',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}

module.exports = errorHandler;
