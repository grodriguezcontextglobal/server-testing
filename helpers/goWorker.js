const { createCircuitBreaker } = require("./circuitBreaker");

/**
 * fetchImpl inyectable para tests (sin red real). breakerOpts se reenvía a
 * createCircuitBreaker (failureThreshold/cooldownMs), por si un caller
 * necesita afinar el umbral para un test o un entorno específico.
 */
function createRunGoWorker(fetchImpl = fetch, breakerOpts = {}) {
  const callGoWorker = async (command, args, retries = 3) => {
    const host = process.env.GO_WORKER_HOST || "localhost";
    const port = process.env.GO_WORKER_PORT || 7453;
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
          throw new Error(
            `Go Worker Connection Failed after ${retries} attempts: ${error.message}. Ensure the Go worker is running.`
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

module.exports = runGoWorker;
