import "dotenv/config";
import { prisma } from "../src/lib/db";
import { getState, setState } from "../src/lib/settings";
import { trySendOne, recoverCrashed, closeFinishedCampaigns } from "../src/lib/sender";
import { ensureDrafts } from "../src/lib/drafts";
import { syncInbox } from "../src/lib/inbox";
import { log } from "../src/lib/log";

const TICK_MS = 20_000;
const SYNC_MS = 10 * 60_000;
let busy = false;
let stopping = false;

async function tick() {
  if (busy || stopping) return;
  busy = true;
  try {
    await setState({ lastWorkerTick: new Date().toISOString() });
    const st = await getState();
    if (!st.lastSyncAt || Date.now() - new Date(st.lastSyncAt).getTime() >= SYNC_MS) {
      await syncInbox().catch(async (e) => {
        await log("error", "inbox", `sync failed: ${e instanceof Error ? e.message : e}`);
        await setState({ lastSyncAt: new Date().toISOString() }); // try again in 10 min
      });
    }
    await ensureDrafts().catch((e) => log("error", "ai", `ensureDrafts: ${e instanceof Error ? e.message : e}`));
    const r = await trySendOne();
    if (r !== "waiting gap" && r !== "nothing to send" && r !== "stopped") console.log(new Date().toISOString(), "send:", r);
    await closeFinishedCampaigns();
  } catch (e) {
    await log("error", "worker", e instanceof Error ? e.stack || e.message : String(e));
  } finally { busy = false; }
}

async function main() {
  await recoverCrashed();
  await log("info", "worker", "worker started");
  await tick();
  setInterval(tick, TICK_MS);
}

async function shutdown() {
  stopping = true;
  // let an in-flight send finish so its result is recorded
  for (let i = 0; i < 60 && busy; i++) await new Promise((r) => setTimeout(r, 1000));
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main();
