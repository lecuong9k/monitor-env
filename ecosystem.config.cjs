module.exports = {
  apps: [
    {
      name: "mediamtx",
      script: "npm",
      args: "run mediamtx:prod",
      cwd: __dirname,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "monitor-env",
      script: "npm",
      args: "run start",
      cwd: __dirname,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
