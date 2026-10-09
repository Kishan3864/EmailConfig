import { C, nowIso, rows, type Campaign, type Lead } from "./fsdb";
import { getSettings, getState, setState } from "./settings";
import { fetchFacts, type Facts } from "./facts";
import { generateDraft } from "./ai";
import { log, event } from "./log";

const BATCH = 3; // keep only a few drafts ready ahead of sending (free API limits)

/** Generate + validate a draft for one lead. A draft is stored only if it passes validation. */
export async function draftForLead(leadId: string): Promise<{ ok: boolean; error?: string }> {
  const s = await getSettings();
  const ld = await C.leads.doc(leadId).get();
  if (!ld.exists) return { ok: false, error: "lead not found" };
  const lead = { id: ld.id, ...ld.data() } as Lead;
  if (!lead.campaignId) return { ok: false, error: "lead not in a campaign" };
  if ((await C.messages.doc(leadId).get()).exists) return { ok: true };
  const cd = await C.campaigns.doc(lead.campaignId).get();
  const campaign = { id: cd.id, ...cd.data() } as Campaign;

  let facts: Facts;
  if (lead.facts) facts = JSON.parse(lead.facts);
  else {
    facts = await fetchFacts(lead.website); // fetched once, then stored
    await ld.ref.update({ facts: JSON.stringify(facts), factsAt: nowIso() });
  }

  const jobRef = C.draftJobs.doc(leadId);
  const job = await jobRef.get();
  try {
    const d = await generateDraft(lead, facts, campaign.language, s);
    if (d.errors.length) throw new Error("validation: " + d.errors.join("; "));
    // create() fails if a message already exists -> never two messages for one lead
    await C.messages.doc(leadId).create({
      leadId, leadEmail: lead.email, businessName: lead.businessName || null, campaignId: campaign.id, language: campaign.language,
      subject: d.subject, body: d.body, subjectEn: d.subjectEn, bodyEn: d.bodyEn, status: "ready", attempts: 0, dryRunDone: false, createdAt: nowIso(),
    });
    await ld.ref.update({ hasMessage: true });
    await jobRef.delete().catch(() => {});
    await event(leadId, "draft", "validated draft created");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ALREADY_EXISTS/i.test(msg)) { await ld.ref.update({ hasMessage: true }); return { ok: true }; }
    const attempts = ((job.exists && job.get("attempts")) || 0) + 1;
    const wait = Math.min(15 * attempts, 360) * 60000;
    await jobRef.set({ attempts, lastError: msg.slice(0, 500), nextTryAt: new Date(Date.now() + wait).toISOString(), campaignId: campaign.id });
    if (/HTTP 429|rate/i.test(msg)) await setState({ aiBackoffUntil: new Date(Date.now() + 30 * 60000).toISOString() });
    await log("warn", "ai", `draft failed for ${lead.email} (attempt ${attempts}): ${msg.slice(0, 300)}`);
    return { ok: false, error: msg };
  }
}

/** Keep a small batch of validated drafts ready for every running campaign. */
export async function ensureDrafts() {
  const st = await getState();
  if (st.aiBackoffUntil && new Date(st.aiBackoffUntil) > new Date()) return;
  const s = await getSettings();
  const campaigns = rows<Campaign>(await C.campaigns.where("status", "==", "running").get());
  for (const c of campaigns) {
    let q = C.messages.where("campaignId", "==", c.id).where("status", "==", "ready");
    if (s.dryRun) q = q.where("dryRunDone", "==", false);
    const ready = (await q.limit(BATCH).get()).size;
    if (ready >= BATCH) continue;
    const waiting = new Set((await C.draftJobs.where("nextTryAt", ">", nowIso()).get()).docs.map((d) => d.id));
    const cands = (await C.leads.where("campaignId", "==", c.id).where("status", "==", "ready").where("hasMessage", "==", false).orderBy("createdAt").limit(20).get()).docs;
    let need = BATCH - ready;
    for (const l of cands) {
      if (need <= 0) break;
      if (waiting.has(l.id) || (await C.messages.doc(l.id).get()).exists) continue;
      const r = await draftForLead(l.id);
      need--;
      if (!r.ok && /HTTP 429/.test(r.error || "")) return;
    }
  }
}

/** First 5 drafts of a campaign, shown for approval before the first send. */
export async function generateSamples(campaignId: string) {
  const leads = (await C.leads.where("campaignId", "==", campaignId).where("status", "==", "ready").orderBy("createdAt").limit(5).get()).docs;
  const errors: string[] = [];
  for (const l of leads) {
    if ((await C.messages.doc(l.id).get()).exists) continue;
    await C.draftJobs.doc(l.id).delete().catch(() => {});
    const r = await draftForLead(l.id);
    if (!r.ok) errors.push(`${l.get("email")}: ${r.error}`);
  }
  return errors;
}
