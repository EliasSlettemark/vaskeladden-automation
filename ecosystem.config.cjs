module.exports = {
  apps: [
    {
      name: "vaskeladden-automation",
      exec_mode: "fork",
      cwd: "/opt/vaskeladden-automation",
      script: "dist/index.js",
      interpreter: "node",
      node_args: "--env-file=.env",
      instances: 1,
      autorestart: true,
      max_memory_restart: "800M",
    },
  ],
};
