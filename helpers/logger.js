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

/**
 * UN ARCHIVO POR PROCESO (APP-2026-002 · AU-11, AU-4).
 *
 * La rotación de `winston.transports.File` es por tamaño y CADA PROCESO lleva
 * su propio contador. En la VM escriben en los mismos archivos las cuatro
 * instancias de la API (pm2) más los workers de la cola, así que seis
 * contadores independientes rotaban el mismo `combined.log` y se pisaban los
 * índices: por eso el 2026-11-16 los `combined1.log` a `combined4.log` eran de
 * mayo a agosto mientras `combined.log` era de noviembre. Los archivos
 * antiguos no "sobrevivían" a los recientes: los recientes se perdían al ser
 * renombrados encima de ellos.
 *
 * No era una ventana corta, era una rotación rota. Y eso importa más allá del
 * tamaño: la decisión de pasar los modos de autorización a `enforce`
 * (APP-2026-004) se apoya en "no hay eventos en el registro", frase que no
 * significa nada si el registro se estaba comiendo a sí mismo.
 *
 * Con un archivo por proceso cada contador es el único dueño de su serie. El
 * precio es más archivos; `scripts/summarize-warn-logs.js` ya los lee todos.
 */
const fileTag = () => processRole().replace(/[^a-zA-Z0-9_-]/g, '-');

/**
 * Capacidad por serie, configurable sin desplegar código.
 *
 * AU-11 pide 90 días EN LÍNEA. Con la medición del 2026-11-16 —25 MB para unas
 * 84 horas, sumando todos los procesos— 90 días son del orden de 640 MB en
 * total. Repartidos entre seis series salen ~107 MB cada una, de ahí los 12
 * archivos de 10 MB de abajo.
 *
 * Son variables de entorno PORQUE la cuenta depende del tráfico y el disco de
 * la VM estaba al 10% libre en septiembre: ajustar la retención no debería
 * exigir un despliegue. La verificación de los 90 días es el hito de
 * 2027-02-14 y se mide, no se supone.
 */
const sizeMb = (name, fallback) => {
  const asked = Number(process.env[name]);
  return Math.max(1, Number.isFinite(asked) && asked > 0 ? asked : fallback) * 1024 * 1024;
};
const count = (name, fallback) => {
  const asked = Number(process.env[name]);
  return Math.max(1, Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : fallback);
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
    // Los errores, en la serie de este proceso.
    new winston.transports.File({
      filename: path.join(logsDir, `error-${fileTag()}.log`),
      level: 'error',
      maxsize: sizeMb('LOG_ERROR_MAX_MB', 5),
      maxFiles: count('LOG_ERROR_MAX_FILES', 10),
    }),
    // Todo lo demás.
    new winston.transports.File({
      filename: path.join(logsDir, `combined-${fileTag()}.log`),
      level,
      maxsize: sizeMb('LOG_COMBINED_MAX_MB', 10),
      maxFiles: count('LOG_COMBINED_MAX_FILES', 12),
    }),
    // Una línea JSON por petición (AU-2 / AU-12).
    new winston.transports.File({
      filename: path.join(logsDir, `requests-${fileTag()}.log`),
      level: 'http',
      format: winston.format.combine(onlyHttp(), winston.format.json()),
      maxsize: sizeMb('LOG_REQUESTS_MAX_MB', 10),
      maxFiles: count('LOG_REQUESTS_MAX_FILES', 12),
    }),
  ],
  // Handle exceptions and rejections.
  // Estos dos SÍ necesitan techo: son los que se llenan en un bucle de crashes,
  // una línea por excepción no capturada y por instancia del cluster. El 9-sep,
  // con uuid tumbando el arranque, esto escribió miles de líneas en minutos
  // sobre un disco que estaba al 10% libre.
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, `exceptions-${fileTag()}.log`),
      maxsize: sizeMb('LOG_EXCEPTIONS_MAX_MB', 5),
      maxFiles: count('LOG_EXCEPTIONS_MAX_FILES', 5),
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, `rejections-${fileTag()}.log`),
      maxsize: sizeMb('LOG_REJECTIONS_MAX_MB', 5),
      maxFiles: count('LOG_REJECTIONS_MAX_FILES', 5),
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