const { execFile } = require("child_process");
const path = require("path");

/**
 * Controller to handle heavy tasks via Go
 */
const handleHeavyTask = async (req, res) => {
  try {
    // 1. Get file path (In real app, this comes from req.file.path via Multer)
    // For demo, we just pass a dummy string if no file uploaded
    const filePath = req.file ? req.file.path : "dummy_upload.xlsx";

    // 2. Define path to Go executable
    const goExecutable = path.join(
      __dirname,
      "../go-worker/processor.exe"
    );

    // 3. Spawn the Go process
    // This is ASYNCHRONOUS. Node.js continues to serve other requests.
    // const child = 
    execFile(goExecutable, [filePath], (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({ ok: false, msg: "Worker failed", error: error.message });
      }

      if (stderr) {
        return res.status(500).json({ ok: false, msg: "Worker stderr", error: stderr });
      }

      try {
        // 4. Parse the JSON result from Go
        const result = JSON.parse(stdout);


        return res.json({
          ok: true,
          msg: "Task processed successfully",
          workerResponse: result,
        });
      } catch (parseError) {
        return res.status(500).json({ ok: false, msg: "Invalid response from worker", error: JSON.stringify(parseError) });
      }
    });

    // Optional: You can respond immediately to the user if you don't want to wait
    // res.json({ ok: true, msg: "Task started successfully. We will notify you when done." });

  } catch (error) {
    return res.status(500).json({ ok: false, msg: "Server error", error: JSON.stringify(error) });
  }
};

module.exports = {
  handleHeavyTask,
};
