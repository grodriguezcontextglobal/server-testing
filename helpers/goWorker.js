const runGoWorker = async (command, args, retries = 3) => {
  const port = process.env.GO_WORKER_PORT || 7453;
  const url = `http://localhost:${port}/${command}`;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
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

module.exports = runGoWorker;
