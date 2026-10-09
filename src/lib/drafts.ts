import { prisma } from "./db";
import { getSettings, getState, setState } from "./settings";
import { fetchFacts, type Facts } from "./facts";
import { generateDraft } from "./ai";
import { log, event } from "./log";

const BATCH = 3; // keep only a few drafts ready ahead of sending (free API limits)

/** Generate + validate a draft for one lead. Returns true when a valid draft was stored. */
export async function draftForLead(leadId: number): Promise<{ ok: boolean; error?: string }> {
  const s = await getSettings();
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { campaign: true, message: true } });
  if (!lead || !lead.campaign) return { ok: false, error: "lead not in a campaign" };
  if (lead.message) return { ok: true };

  let facts: Facts;
  if (lead.facts) facts = JSON.parse(lead.facts);
  else {
    facts = await fetchFacts(lead.website); // fetched once, then stored
    await prisma.lead.update({ where: { id: lead.id }, data: { facts: JSON.stringify(facts), factsAt: new Date() } });
  }

  const job = await prisma.draftJob.findUnique({ where: { leadId } });
  try {
    const d = await generateDraft(lead, facts, lead.campaign.language, s);
    if (d.errors.length) throw new Error("validation: " + d.errors.join("; "));
    await prisma.message.create({
      data: { leadId, campaignId: lead.campaign.id, language: lead.campaign.language, subject: d.subject, body: d.body, subjectEn: d.subjectEn, bodyEn: d.bodyEn, status: "ready" },
    });
    await prisma.draftJob.deleteMany({ where: { leadId } });
    await event(leadId, "draft", "validated draft created");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const attempts = (job?.attempts || 0) + 1;
    const wait = Math.min(15 * attempts, 360) * 60000;
    await prisma.draftJob.upsert({
      where: { leadId },
      create: { leadId, attempts, lastError: msg.slice(0, 500), nextTryAt: new Date(Date.now() + wait) },
      update: { attempts, lastError: msg.slice(0, 500), nextTryAt: new Date(Date.now() + wait) },
    });
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
  const campaigns = await prisma.campaign.findMany({ where: { status: "running" } });
  for (const c of campaigns) {
    const ready = await prisma.message.count({
      where: { campaignId: c.id, status: "ready", lead: { status: "ready", ...(s.dryRun ? { dryRunAt: null } : {}) } },
    });
    if (ready >= BATCH) continue;
    const jobsWaiting = await prisma.draftJob.findMany({ where: { nextTryAt: { gt: new Date() } }, select: { leadId: true } });
    const leads = await prisma.lead.findMany({
      where: { campaignId: c.id, status: "ready", message: null, id: { notIn: jobsWaiting.map((j) => j.leadId) } },
      orderBy: { id: "asc" }, take: BATCH - ready,
    });
    for (const l of leads) {
      const r = await draftForLead(l.id);
      if (!r.ok && /HTTP 429/.test(r.error || "")) return;
    }
  }
}

/** First 5 drafts of a campaign, shown for approval before the first send. */
export async function generateSamples(campaignId: number) {
  const leads = await prisma.lead.findMany({ where: { campaignId, status: "ready" }, orderBy: { id: "asc" }, take: 5, include: { message: true } });
  const errors: string[] = [];
  for (const l of leads) {
    if (l.message) continue;
    await prisma.draftJob.deleteMany({ where: { leadId: l.id } });
    const r = await draftForLead(l.id);
    if (!r.ok) errors.push(`${l.email}: ${r.error}`);
  }
  return errors;
}
