'use strict';

const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error('Unhandled error', {
    status,
    message,
    method: req.method,
    url: req.originalUrl,
    stack: status >= 500 ? err.stack : undefined,
  });

  res.status(status).json({
    success: false,
    message: status >= 500 ? 'Internal Server Error' : message,
  });
}

module.exports = { errorHandler };
