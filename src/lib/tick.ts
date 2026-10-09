import { randomUUID } from "crypto";
import { db, C, nowIso } from "./fsdb";
import { getSettings, getState, setState } from "./settings";
import { trySendOne, recoverCrashed, closeFinishedCampaigns } from "./sender";
import { ensureDrafts } from "./drafts";
import { syncInbox } from "./inbox";
import { inWindow } from "./schedule";
import { log } from "./log";

const SYNC_MS = 10 * 60_000;
const LEASE_MS = 8 * 60_000;

/** Single-runner lease in Firestore: a second worker/function instance can never send at the same time. */
async function acquire(owner: string) {
  const ref = C.kv.doc("lock");
  return db.runTransaction(async (tx) => {
    const d = await tx.get(ref);
    if (d.exists && d.get("until") > Date.now() && d.get("owner") !== owner) return false;
    tx.set(ref, { owner, until: Date.now() + LEASE_MS, at: nowIso() });
    return true;
  });
}
async function release(owner: string) {
  const ref = C.kv.doc("lock");
  await db.runTransaction(async (tx) => {
    const d = await tx.get(ref);
    if (d.exists && d.get("owner") === owner) tx.set(ref, { owner: null, until: 0, at: nowIso() });
  });
}

/** One worker cycle: recover, sync inbox (every 10 min), prepare drafts, send at most one mail. */
export async function runTick(): Promise<string> {
  const owner = randomUUID();
  if (!(await acquire(owner))) return "another worker is running";
  try {
    await setState({ lastWorkerTick: nowIso() });
    await recoverCrashed();
    const st = await getState();
    if (!st.lastSyncAt || Date.now() - new Date(st.lastSyncAt).getTime() >= SYNC_MS) {
      await syncInbox().catch(async (e) => {
        await log("error", "inbox", `sync failed: ${e instanceof Error ? e.message : e}`);
        await setState({ lastSyncAt: nowIso() }); // try again in 10 min
      });
    }
    // drafts only while some running campaign is inside (or 30 min before) its sending window
    const s = await getSettings();
    const running = (await C.campaigns.where("status", "==", "running").get()).docs;
    const soon = new Date(Date.now() + 30 * 60000);
    if (!st.globalStop && !st.alert && running.some((c) => inWindow(new Date(), s, c.get("timezone")) || inWindow(soon, s, c.get("timezone")))) {
      await ensureDrafts().catch((e) => log("error", "ai", `ensureDrafts: ${e instanceof Error ? e.message : e}`));
    }
    const r = await trySendOne();
    await closeFinishedCampaigns();
    return r;
  } catch (e) {
    await log("error", "worker", e instanceof Error ? e.stack || e.message : String(e));
    return "error";
  } finally {
    await release(owner).catch(() => {});
  }
}
