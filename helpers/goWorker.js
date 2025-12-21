const runGoWorker = async (command, args) => {
  const port = process.env.GO_WORKER_PORT || 8081;
  const url = `http://localhost:${port}/${command}`;

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
    throw new Error(
      `Go Worker Connection Failed: ${error.message}. Ensure the Go worker is running.`
    );
  }
};

module.exports = runGoWorker;
