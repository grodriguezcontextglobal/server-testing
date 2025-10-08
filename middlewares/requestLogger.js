const logger = require('../helpers/logger');

/**
 * Request logging middleware that captures comprehensive client information
 * and request details for monitoring, debugging, and security purposes
 */
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Extract client information from headers
  const clientInfo = {
    userAgent: req.get('User-Agent'),
    language: req.get('Accept-Language'),
    timezone: req.get('X-Timezone'),
    requestTimestamp: req.get('X-Request-Timestamp'),
    requestId: req.get('X-Request-ID'),
    realIP: req.get('X-Real-IP'),
    forwardedFor: req.get('X-Forwarded-For'),
    clientIP: req.get('X-Client-IP'),
    actualIP: req.ip,
    ips: req.ips
  };

  // Extract request information
  const requestInfo = {
    method: req.method,
    url: req.originalUrl,
    path: req.path,
    query: req.query,
    protocol: req.protocol,
    secure: req.secure,
    hostname: req.hostname,
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    authorization: req.get('x-token') ? 'Bearer [REDACTED]' : 'None',
    referer: req.get('Referer'),
    origin: req.get('Origin')
  };

  // Log the incoming request
  logger.log('http', 'Incoming Request', {
    type: 'request_start',
    requestInfo,
    clientInfo,
    timestamp: new Date().toISOString(),
    serverTimestamp: startTime
  });

  // Override res.end to capture response information
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Log the response
    logger.log('http', 'Request Completed', {
      type: 'request_end',
      requestInfo: {
        method: req.method,
        url: req.originalUrl,
        requestId: clientInfo.requestId
      },
      responseInfo: {
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
        contentLength: res.get('Content-Length'),
        contentType: res.get('Content-Type')
      },
      performance: {
        duration: `${duration}ms`,
        startTime,
        endTime
      },
      clientInfo: {
        requestId: clientInfo.requestId,
        userAgent: clientInfo.userAgent,
        realIP: clientInfo.realIP || clientInfo.forwardedFor || clientInfo.actualIP,
        timezone: clientInfo.timezone
      },
      timestamp: new Date().toISOString()
    });

    // Log slow requests (over 5 seconds)
    if (duration > 5000) {
      logger.warn('Slow Request Detected', {
        type: 'slow_request',
        duration: `${duration}ms`,
        method: req.method,
        url: req.originalUrl,
        requestId: clientInfo.requestId,
        clientInfo,
        timestamp: new Date().toISOString()
      });
    }

    // Log error responses
    if (res.statusCode >= 400) {
      const logLevel = res.statusCode >= 500 ? 'error' : 'warn';
      logger.log(logLevel, 'Error Response', {
        type: 'error_response',
        statusCode: res.statusCode,
        method: req.method,
        url: req.originalUrl,
        requestId: clientInfo.requestId,
        clientInfo,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      });
    }

    // Call the original end method
    originalEnd.call(this, chunk, encoding);
  };

  next();
};

/**
 * Security monitoring middleware for suspicious activities
 */
const securityLogger = (req, res, next) => {
  const clientInfo = {
    userAgent: req.get('User-Agent'),
    requestId: req.get('X-Request-ID'),
    realIP: req.get('X-Real-IP') || req.get('X-Forwarded-For') || req.ip,
    timezone: req.get('X-Timezone')
  };

  // Log suspicious patterns
  const suspiciousPatterns = [
    /\.\.\//,  // Path traversal
    /<script/i, // XSS attempts
    /union.*select/i, // SQL injection
    /exec\(/i, // Code injection
    /eval\(/i  // Code injection
  ];

  const url = req.originalUrl.toLowerCase();
  const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(url));

  if (isSuspicious) {
    logger.warn('Suspicious Request Detected', {
      type: 'security_alert',
      method: req.method,
      url: req.originalUrl,
      clientInfo,
      timestamp: new Date().toISOString()
    });
  }

  // Log failed authentication attempts
  if (req.path.includes('/auth/') && req.method === 'POST') {
    res.on('finish', () => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        logger.warn('Authentication Failure', {
          type: 'auth_failure',
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
          clientInfo,
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  next();
};

module.exports = {
  requestLogger,
  securityLogger
};