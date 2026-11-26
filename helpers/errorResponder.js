/**
 * EL RESPONDEDOR DE ERRORES COMUN (APP-2026-013 · SI-11).
 *
 * SI-11 pide que un error interno no salga al cliente. Hoy sale: `POST
 * /api/db_item/consulting-item` con un cuerpo vacio devuelve
 * `{"msg":"syntax error at position 29"}`, que es el mensaje del motor SQL
 * entregado a quien hizo la peticion. Medido el 2026-11-25: 19 sitios con
 * `JSON.stringify(error)` —que arrastra el objeto entero, no solo el
 * mensaje— y 245 con `msg: error` en crudo, en 41 archivos.
 *
 * EL PROBLEMA NO ES DECIR DEMASIADO, ES NO PODER DECIR MENOS.
 *
 * Un `msg: "Server error"` a secas cumple SI-11 y deja al equipo sin nada que
 * mirar cuando el cliente llama diciendo "me da error". Por eso esto no es un
 * censor: es un CAMBIO DE DESTINATARIO. El detalle entero —mensaje, pila,
 * ruta, usuario, codigo del motor— va al registro; al cliente va una frase
 * generica y una REFERENCIA que apunta a esa linea del registro.
 *
 * Asi, "me da error" se convierte en "me da error, referencia a3f91c2b4e07",
 * y esa referencia encuentra el detalle completo en una busqueda.
 *
 * LA REFERENCIA LA GENERA EL SERVIDOR.
 *
 * Hay un `requestId` en requestLogger.js y en auditPlatformAccess.js, pero
 * sale de la cabecera `X-Request-ID`, o sea del cliente: puede no venir y
 * puede venir inventada. Para correlacionar hace falta un identificador que
 * nadie de fuera controle. El del cliente se sigue registrando, al lado, por
 * si sirve para cruzar con sus propios registros.
 */

const crypto = require('node:crypto');
const logger = require('./logger');

/** Lo que ve el cliente cuando no hay nada mejor que decirle. */
const GENERIC_MESSAGE = 'The server could not complete the request';

/**
 * Doce caracteres hexadecimales, no un UUID.
 *
 * Esto lo lee una persona en una pantalla y a veces lo dicta por telefono a
 * soporte. 2^48 combinaciones sobran para distinguir los errores de un dia, y
 * un UUID de 36 caracteres con guiones no se dicta.
 */
const newRef = () => crypto.randomBytes(6).toString('hex');

/**
 * Middleware: una referencia por peticion, antes de que nada pueda fallar.
 *
 * Va en `request.errorRef` para que, si una peticion falla en dos sitios, los
 * dos registros lleven la MISMA referencia y se vea que fue una sola peticion
 * y no dos incidentes.
 */
const attachErrorRef = (request, response, next) => {
  if (!request.errorRef) request.errorRef = newRef();
  // Devolverla siempre, no solo al fallar: si el cliente la registra, un
  // problema que no llego a ser un 500 tambien se puede cruzar.
  response.setHeader('X-Error-Ref', request.errorRef);
  next();
};

/**
 * Lo que de un error se puede registrar sin riesgo.
 *
 * NO se registra el objeto entero. Un error de driver de base de datos puede
 * traer colgando la consulta con sus parametros, y los parametros son datos de
 * cliente: registrar eso convierte el archivo de log en una copia parcial de la
 * base de datos, que es el problema de AU-9 por otro camino.
 */
const detail = (error) => {
  if (!error) return { message: null };
  return {
    message: error.message || String(error),
    name: error.name || null,
    // Codigos de MySQL y de Mongo: dicen que paso sin decir con que datos.
    code: error.code ?? error.errno ?? null,
    sqlState: error.sqlState ?? null,
    stack: error.stack || null,
  };
};

/**
 * Responde un error sin filtrar nada, y deja el detalle en el registro.
 *
 *   } catch (error) {
 *     return respondError(request, response, error);
 *   }
 *
 * `status` por si el sitio ya sabia que no era un 500. `msg` por si hay una
 * frase util para el cliente QUE NO VENGA DEL ERROR: "ese evento no existe"
 * esta bien, `error.message` no, y es justo lo que esto impide.
 */
const respondError = (request, response, error, options = {}) => {
  const { status = 500, msg = GENERIC_MESSAGE, context = {} } = options;
  const ref = request?.errorRef || newRef();

  logger.error('Handled error', {
    type: 'handled_error',
    ref,
    error: detail(error),
    method: request?.method || null,
    url: request?.originalUrl || request?.url || null,
    uid: request?.uid || null,
    // El de la cabecera, para cruzar con los registros del cliente. Puede ser
    // nulo o inventado: por eso no es `ref`.
    clientRequestId: request?.headers?.['x-request-id'] || null,
    ...context,
  });

  if (response?.headersSent) return response;
  return response.status(status).json({ ok: false, msg, ref });
};

module.exports = {
  GENERIC_MESSAGE,
  attachErrorRef,
  respondError,
  detail,
  newRef,
};
