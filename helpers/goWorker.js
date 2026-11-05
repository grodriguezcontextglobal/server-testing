const { createCircuitBreaker } = require("./circuitBreaker");

/**
 * Error que el worker REPORTÓ (HTTP 200 con status:"error"), no un fallo de
 * transporte. Se distingue porque las dos cosas piden lo contrario:
 *
 *  - transporte (ECONNREFUSED, timeout, 5xx): reintentar tiene sentido, y
 *    acumular fallos debe abrir el circuito para proteger al worker.
 *  - reportado por el worker ("disallowed column for update: return_date",
 *    "company_id is required"): es determinista — reintentarlo tres veces da
 *    tres veces el mismo error, y contarlo en el breaker deja al Go worker
 *    inalcanzable para TODA la app por 30s (failureThreshold=5) por culpa de
 *    un payload malo de un solo cliente.
 *
 * Antes las dos clases se mezclaban y el mensaje final decía "Go Worker
 * Connection Failed ... Ensure the Go worker is running and reachable" incluso
 * cuando el worker había contestado perfectamente — mandando a quien depura a
 * revisar puertos y servicios en vez de su propio payload.
 */
class GoWorkerReportedError extends Error {
  constructor(message, command) {
    super(message);
    this.name = "GoWorkerReportedError";
    this.workerReported = true;
    this.command = command;
  }
}

/**
 * fetchImpl inyectable para tests (sin red real). breakerOpts se reenvía a
 * createCircuitBreaker (failureThreshold/cooldownMs), por si un caller
 * necesita afinar el umbral para un test o un entorno específico.
 */
// Debe coincidir con el default del lado Go (go-worker/main.go). Si los dos
// lados caen a defaults DISTINTOS, un entorno donde solo uno de los dos
// procesos tiene GO_WORKER_PORT seteado queda desalineado en silencio — que es
// exactamente el bug que rompió prod (Node leía 7452 del .env mientras el
// worker escuchaba en el 7453 que le inyectaba nssm).
const DEFAULT_GO_WORKER_PORT = 7453;

/**
 * Única fuente de verdad de DÓNDE vive el Go worker. Exportada para que el
 * arranque (index.js) loguee exactamente el mismo destino que se va a llamar en
 * runtime, en vez de recalcularlo por su cuenta y poder divergir.
 */
const resolveWorkerTarget = () => ({
  // 127.0.0.1 y no "localhost": el worker escucha solo en IPv4 loopback y
  // "localhost" puede resolver primero a ::1 en Windows.
  host: process.env.GO_WORKER_HOST || "127.0.0.1",
  port: process.env.GO_WORKER_PORT || DEFAULT_GO_WORKER_PORT,
});

function createRunGoWorker(fetchImpl = fetch, breakerOpts = {}) {
  const callGoWorker = async (command, args, retries = 3) => {
    const { host, port } = resolveWorkerTarget();
    const url = `http://${host}:${port}/${command}`;

    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `Go Worker HTTP error: ${response.status} ${response.statusText} - ${text}`
          );
        }

        const result = await response.json();
        if (result.status === "error") {
          // El worker contestó y rechazó la operación: no se reintenta ni se
          // reescribe el mensaje. Sale tal cual, nombrando el comando.
          throw new GoWorkerReportedError(result.message, command);
        }
        return result.data;
      } catch (error) {
        if (error instanceof GoWorkerReportedError) throw error;
        if (i === retries - 1) {
          // El `cause` trae el código real (ECONNREFUSED/ECONNRESET/...), que
          // `fetch` esconde detrás de un "fetch failed" genérico; y la URL dice
          // a DÓNDE se intentó conectar. Sin esos dos datos, un simple
          // desalineamiento de puerto es indistinguible de un worker caído.
          const cause = error.cause ? ` (${error.cause.code || error.cause.message || error.cause})` : "";
          throw new Error(
            `Go Worker Connection Failed after ${retries} attempts to ${url}: ${error.message}${cause}. Ensure the Go worker is running and reachable at that address.`
          );
        }
        // Wait for a short period before retrying (e.g., 100ms, 200ms, 400ms)
        await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, i)));
      }
    }
  };

  // El breaker envuelve la operación COMPLETA (con sus reintentos internos)
  // como una sola unidad: "¿esta llamada al Go worker tuvo éxito o no?". Así
  // failureThreshold cuenta invocaciones de runGoWorker fallidas entre
  // distintas requests, no cada intento de fetch individual dentro de una.
  //
  // isFailure excluye los errores que el worker REPORTÓ: el worker está sano,
  // el que está mal es el payload. Contarlos abriría el circuito y dejaría al
  // Go worker inalcanzable para toda la app por culpa de un cliente.
  return createCircuitBreaker(callGoWorker, {
    isFailure: (error) => !(error && error.workerReported),
    ...breakerOpts,
  });
}

const runGoWorker = createRunGoWorker();
runGoWorker.createRunGoWorker = createRunGoWorker;
runGoWorker.resolveWorkerTarget = resolveWorkerTarget;
runGoWorker.DEFAULT_GO_WORKER_PORT = DEFAULT_GO_WORKER_PORT;
runGoWorker.GoWorkerReportedError = GoWorkerReportedError;

module.exports = runGoWorker;
