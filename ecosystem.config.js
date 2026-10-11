// pm2 config for a VPS. The web app listens on localhost only; nginx (or another proxy) serves it over HTTPS.
// Change the port with:  OUTREACH_PORT=3500 pm2 start ecosystem.config.js
const PORT = process.env.OUTREACH_PORT || "3417";

module.exports = {
  apps: [
    {
      name: "outreach-web",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: `start -H 127.0.0.1 -p ${PORT}`,
      env: { NODE_ENV: "production" },
      max_memory_restart: "600M",
    },
    {
      name: "outreach-worker",
      cwd: __dirname,
      script: "node_modules/tsx/dist/cli.mjs",
      args: "worker/index.ts",
      env: { NODE_ENV: "production" },
      max_restarts: 50,
      restart_delay: 10000,
      kill_timeout: 70000, // let an in-flight send finish and be recorded before pm2 kills the process
    },
  ],
};
