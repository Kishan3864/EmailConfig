// Local worker (optional). On Firebase the same tick runs as a scheduled Cloud Function (functions/).
import "dotenv/config";
import { runTick } from "../src/lib/tick";

const TICK_MS = 60_000;
let busy = false;
let stopping = false;

async function tick() {
  if (busy || stopping) return;
  busy = true;
  try {
    const r = await runTick();
    if (!["waiting gap", "nothing to send", "stopped"].includes(r)) console.log(new Date().toISOString(), "tick:", r);
  } finally { busy = false; }
}

async function shutdown() {
  stopping = true;
  // let an in-flight send finish so its result is recorded
  for (let i = 0; i < 60 && busy; i++) await new Promise((r) => setTimeout(r, 1000));
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("worker started");
tick();
setInterval(tick, TICK_MS);
