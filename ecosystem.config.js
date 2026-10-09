module.exports = {
  apps: [
    { name: "outreach-web", script: "node_modules/next/dist/bin/next", args: "start -p 3001", env: { NODE_ENV: "production" } },
    { name: "outreach-worker", script: "node_modules/tsx/dist/cli.mjs", args: "worker/index.ts", env: { NODE_ENV: "production" }, max_restarts: 50, restart_delay: 10000 },
  ],
};
