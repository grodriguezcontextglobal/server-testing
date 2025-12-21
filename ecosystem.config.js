module.exports = {
  apps: [
    {
      name: "index",
      script: "./index.js",
      instances: "4",
      exec_mode: "cluster",
      node_args: "--expose-gc --max-old-space-size=250",
      // max_memory_restart: "200M",
      disable_metric: true,
    },
    {
      name: "go-worker",
      script: "./go-worker/processor.exe",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
    },
  ],
};
  