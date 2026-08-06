const { createCircuitBreaker } = require("./circuitBreaker");

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
  host: process.env.GO_WORKER_HOST || "localhost",
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
          throw new Error(result.message);
        }
        return result.data;
      } catch (error) {
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
  return createCircuitBreaker(callGoWorker, breakerOpts);
}

const runGoWorker = createRunGoWorker();
runGoWorker.createRunGoWorker = createRunGoWorker;
runGoWorker.resolveWorkerTarget = resolveWorkerTarget;
runGoWorker.DEFAULT_GO_WORKER_PORT = DEFAULT_GO_WORKER_PORT;

module.exports = runGoWorker;
