const ErrorLogs = require("../models/ErrorLogs");
const { buildErrorFeedbackMessage } = require("../nodeMailer/notifications");
const { enqueue, extractJobContext } = require("../helpers/queue");

// Mongoose asigna el schema.required en `.validate()`/`.save()`, no al
// construir un documento. Si no se valida aquí, un componentStack/error
// faltante recién fallaría DENTRO del worker (log:error) — invisible para el
// cliente, que ya recibió 200 con un errorId que nunca se va a persistir. Por
// eso se valida antes de responder, igual que el resto de la cola.
const validateErrorFeed = (body) => {
  if (!body.componentStack || !body.error) {
    return { status: 400, body: { ok: false, msg: "componentStack and error are required" } };
  }
  return null;
};

/**
 * POST /api/error_log/error_log
 *
 * El mensaje de respuesta promete un errorId "para referencia futura" — tiene
 * que ser el _id REAL del documento que terminará persistido, no un jobId de
 * la cola. Mongoose asigna el _id a un documento en el momento de construirlo
 * (`new ErrorLogs(...)`), ANTES de guardarlo — se aprovecha eso para responder
 * de inmediato con el id correcto, y se encola la persistencia pasándole ese
 * mismo _id explícito (el worker hace `ErrorLogs.create({_id: errorId, ...})`,
 * que respeta el id dado en vez de generar uno nuevo).
 *
 * Log y correo se encolan como DOS jobs independientes (no uno combinado): si
 * el correo falla, no debe afectar si el log ya se guardó (antes, ambos
 * corrían en el mismo try/catch síncrono — un fallo del correo hacía responder
 * 500 aunque el log ya estuviera guardado). Cada uno lleva su propio
 * idempotencyKey basado en el mismo errorId, para deduplicar reintentos.
 */
function createCreateErrorFeed({
  enqueueFn = enqueue,
  extractContextFn = extractJobContext,
  generateId = () => new ErrorLogs()._id.toString(),
} = {}) {
  return async function createErrorFeed(request, response) {
    try {
      const rejection = validateErrorFeed(request.body);
      if (rejection) {
        return response.status(rejection.status).json(rejection.body);
      }

      const { componentStack, error } = request.body;
      const errorId = generateId();
      const context = extractContextFn(request);

      await enqueueFn(
        "log:error",
        { _id: errorId, componentStack, error },
        { idempotencyKey: `log:error:${errorId}`, context }
      );

      await enqueueFn(
        "send-email",
        buildErrorFeedbackMessage({ errorId, componentStack, error }),
        { idempotencyKey: `send-email:error-notification:${errorId}`, context }
      );

      return response.status(200).json({
        ok: true,
        msg: `Error ID: ${errorId}. Error log created successfully. Please save the id for future reference.`,
        errorId,
      });
    } catch (err) {
      return response.status(500).json({ ok: false, message: err.message });
    }
  };
}

const createErrorFeed = createCreateErrorFeed();

module.exports = {
  createErrorFeed,
  createCreateErrorFeed,
  validateErrorFeed,
};
