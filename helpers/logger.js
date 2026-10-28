const winston = require('winston');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Un registro = una línea JSON (FedRAMP AU-3, A10 2026-10-28). Hasta aquí era
// prettyPrint: bloques de varias líneas que ni un SIEM ni `jq` leen, y que
// scripts/summarize-warn-logs.js tenía que reconstruir a mano (sigue leyendo
// los dos formatos, para los logs viejos). La hora va en ISO 8601 UTC (AU-8):
// antes era la hora local de la VM sin zona.
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Qué proceso escribió el registro. En la VM escriben en los mismos archivos
// las cuatro instancias de la API (pm2) y los workers de la cola.
const processRole = () => {
  if (process.env.QUEUE_GROUP) return `worker:${process.env.QUEUE_GROUP}`;
  if (process.env.NODE_APP_INSTANCE !== undefined) return `api:${process.env.NODE_APP_INSTANCE}`;
  return path.basename(require.main?.filename || 'node', '.js');
};

// requests.log solo recibe el nivel 'http' (una línea JSON por petición, ver
// middlewares/requestLogger.js), y el resto de transportes no lo recibe.
// Hasta 2026-10-21 el logger estaba en 'info' y descartaba todo 'http', así que
// requests.log no se escribía nunca: no quedaba rastro de las peticiones que
// terminaban bien (FedRAMP AU-2 / AU-12).
const onlyHttp = winston.format((info) => (info.level === 'http' ? info : false));
const level = process.env.LOG_LEVEL || 'info';

// Create logger instance
const logger = winston.createLogger({
  // El logger deja pasar 'http'; cada transporte decide su propio nivel.
  level: ['error', 'warn', 'info'].includes(level) ? 'http' : level,
  format: logFormat,
  defaultMeta: { service: 'devitrak-server', host: os.hostname(), pid: process.pid, role: processRole() },
  transports: [
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all logs with level 'info' and below to combined.log
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      level,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write request logs to separate file
    new winston.transports.File({
      filename: path.join(logsDir, 'requests.log'),
      level: 'http',
      format: winston.format.combine(onlyHttp(), winston.format.json()),
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    }),
  ],
  // Handle exceptions and rejections.
  // Estos dos SÍ necesitan techo: son los que se llenan en un bucle de crashes,
  // una línea por excepción no capturada y por instancia del cluster. El 9-sep,
  // con uuid tumbando el arranque, esto escribió miles de líneas en minutos
  // sobre un disco que estaba al 10% libre.
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    level,
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Add custom log level for HTTP requests
winston.addColors({
  error: 'red',
  warn: 'yellow',
  info: 'cyan',
  http: 'magenta',
  debug: 'green'
});

module.exports = logger;
module.exports.processRole = processRole;