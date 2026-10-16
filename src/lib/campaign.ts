import { C, count, nowIso, rows, type Campaign } from "./fsdb";
import type { Settings } from "./settings";
import { estimateFinish } from "./schedule";

/**
 * Start: the campaign runs and the worker makes a draft for every Ready lead (lib/drafts.ts ensureDrafts).
 * It approves NOTHING: every draft, the samples included, waits for my own Approve (lib/approval.ts).
 * samplesApproved is the older name of "started": the sender only sends for started, running campaigns.
 */
export async function startCampaignCore(id: string) {
  await C.campaigns.doc(id).update({ status: "running", samplesApproved: true, startedAt: nowIso() });
}

/**
 * Where every lead of a campaign stands, from "draft still to make" to "sent". Counts only (cheap on reads).
 * dryRun: approved mails already sent to the test address are not in the queue any more (dryDone): they go to the
 * leads only after LIVE is switched on.
 */
export async function pipeline(campaignId: string, dryRun = false) {
  const leads = C.leads.where("campaignId", "==", campaignId);
  const msgs = C.messages.where("campaignId", "==", campaignId);
  const [toCreate, needsText, waiting, queued, sent, failed, skipped, dryDone] = await Promise.all([
    count(leads.where("status", "==", "ready").where("hasMessage", "==", false)),
    count(msgs.where("status", "==", "needs_text")),
    count(msgs.where("status", "==", "ready").where("approved", "==", false)),
    queuedCount(campaignId, dryRun),
    count(leads.where("status", "in", ["sent", "replied", "bounced", "opted_out"])),
    count(msgs.where("status", "in", ["failed", "check_manual"])),
    count(leads.where("status", "in", ["already_contacted", "suppressed", "rejected"])),
    dryRun ? count(msgs.where("status", "==", "ready").where("dryRunDone", "==", true).where("approved", "==", true)) : 0,
  ]);
  return { toCreate, needsText, waiting, queued, sent, failed, skipped, dryDone };
}
export type Pipeline = Awaited<ReturnType<typeof pipeline>>;

/** Approved mails of a campaign still to go out (the send queue); in DRY-RUN only those not yet sent to the test address. */
export const queuedCount = (campaignId: string, dryRun = false) => {
  const q = C.messages.where("campaignId", "==", campaignId).where("status", "in", ["ready", "retry"]);
  return count(dryRun ? q.where("dryRunDone", "==", false).where("approved", "==", true) : q.where("approved", "==", true));
};

/**
 * When the approved queue of this campaign should be sent, with today's limits (window, gap, warm-up daily cap, 40% plan
 * cap). Older running campaigns send first, so their approved queues count ahead of this one.
 */
export async function queueEstimate(s: Settings, c: Campaign, queued: number) {
  if (queued <= 0) return null;
  const older = rows<Campaign>(await C.campaigns.where("status", "==", "running").get()).filter((x) => x.id !== c.id && x.samplesApproved && x.createdAt < c.createdAt);
  let ahead = 0;
  for (const o of older) ahead += await queuedCount(o.id, s.dryRun);
  return estimateFinish(s, c.timezone, queued, ahead);
}
