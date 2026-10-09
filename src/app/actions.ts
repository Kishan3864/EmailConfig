"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSettings, saveSettings, setState, DEFAULTS, type Settings } from "@/lib/settings";
import { testSmtp, testImap, sendTestMail } from "@/lib/mailer";
import { checkDomain } from "@/lib/dnscheck";
import { generateSamples, draftForLead } from "@/lib/drafts";
import { syncInbox } from "@/lib/inbox";
import { log, event } from "@/lib/log";
import { chat } from "@/lib/ai";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------- settings ----------------
export async function saveSettingsAction(fd: FormData) {
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (k === "sendDays") { out[k] = fd.getAll("sendDays").map(Number); continue; }
    if (typeof def === "boolean") { out[k] = fd.get(k) === "on"; continue; }
    const v = fd.get(k);
    if (v === null) continue;
    out[k] = typeof def === "number" ? Number(v) || 0 : String(v).trim();
  }
  await saveSettings(out as Partial<Settings>);
  await log("info", "settings", "settings saved");
  revalidatePath("/settings");
}

export async function testSmtpAction() { try { return await testSmtp(); } catch (e) { return "Error: " + msg(e); } }
export async function testImapAction() { try { return await testImap(); } catch (e) { return "Error: " + msg(e); } }
export async function testMailAction() { try { return await sendTestMail(); } catch (e) { return "Error: " + msg(e); } }
export async function testAiAction() {
  try { const r = await chat([{ role: "user", content: 'Reply with JSON {"ok": true}' }]); return "AI OK: " + r.slice(0, 100); }
  catch (e) { return "Error: " + msg(e); }
}

export async function dnsAction() {
  const s = await getSettings();
  const domain = s.domain || s.fromEmail.split("@")[1];
  if (!domain) return "Error: set your domain or From address";
  const r = await checkDomain(domain, s.dkimSelector);
  await setState({ dns: r });
  revalidatePath("/settings");
  return `${r.spf && r.dkim ? "OK" : "PROBLEM"}\n${r.detail}`;
}

export async function syncNowAction() {
  try { return await syncInbox(); } catch (e) { return "Error: " + msg(e); }
}

// ---------------- global controls ----------------
export async function globalStopAction() {
  await setState({ globalStop: true });
  await prisma.campaign.updateMany({ where: { status: "running" }, data: { status: "paused" } });
  await log("warn", "control", "GLOBAL STOP pressed");
  revalidatePath("/");
  return "All sending stopped";
}
export async function clearStopAction() {
  await setState({ globalStop: false, alert: null });
  await log("info", "control", "global stop / alert cleared (campaigns stay paused until resumed)");
  revalidatePath("/");
  return "Cleared. Resume campaigns one by one.";
}

// ---------------- leads ----------------
export async function approveLead(id: number) {
  await prisma.lead.updateMany({ where: { id, status: "needs_review" }, data: { status: "ready" } });
  await event(id, "approved", "approved after review");
  revalidatePath("/contacts");
}
export async function rejectLead(id: number) {
  await prisma.lead.updateMany({ where: { id, status: "needs_review" }, data: { status: "rejected" } });
  await event(id, "rejected", "rejected after review");
  revalidatePath("/contacts");
}
export async function markCheckedSent(id: number) {
  // after manually checking the Sent folder: it went out
  await prisma.lead.updateMany({ where: { id, status: "check_manual" }, data: { status: "sent" } });
  await prisma.message.updateMany({ where: { leadId: id, status: "check_manual" }, data: { status: "sent", sentAt: new Date() } });
  await event(id, "manual", "marked as sent after manual check");
  revalidatePath(`/contacts/${id}`);
}
export async function markCheckedNotSent(id: number) {
  // it did not go out; we still never resend automatically: lead becomes failed
  await prisma.lead.updateMany({ where: { id, status: "check_manual" }, data: { status: "failed" } });
  await prisma.message.updateMany({ where: { leadId: id, status: "check_manual" }, data: { status: "failed" } });
  await event(id, "manual", "marked as not sent after manual check (not resent)");
  revalidatePath(`/contacts/${id}`);
}

// ---------------- suppression ----------------
export async function addSuppression(fd: FormData) {
  const raw = String(fd.get("values") || "");
  const reason = String(fd.get("reason") || "manual");
  for (const v of raw.split(/[\s,;]+/).map((x) => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean)) {
    const kind = v.includes("@") ? "email" : "domain";
    await prisma.suppression.upsert({ where: { value: v }, create: { value: v, kind, reason }, update: {} });
    if (kind === "email") await prisma.lead.updateMany({ where: { email: v, status: { in: ["ready", "needs_review"] } }, data: { status: "suppressed" } });
    else await prisma.lead.updateMany({ where: { OR: [{ email: { endsWith: "@" + v } }, { businessKey: v }], status: { in: ["ready", "needs_review"] } }, data: { status: "suppressed" } });
  }
  revalidatePath("/suppression");
}

// ---------------- campaigns ----------------
export async function createCampaign(fd: FormData) {
  const listId = Number(fd.get("listId"));
  const c = await prisma.campaign.create({
    data: { name: String(fd.get("name") || "Campaign"), listId, timezone: String(fd.get("timezone")), language: String(fd.get("language")) },
  });
  // attach every unassigned lead of the list (ready or still needing review)
  await prisma.lead.updateMany({ where: { listId, campaignId: null, status: { in: ["ready", "needs_review"] } }, data: { campaignId: c.id } });
  await log("info", "campaign", `campaign "${c.name}" created`);
  redirect(`/campaigns/${c.id}`);
}

export async function samplesAction(id: number) {
  const errs = await generateSamples(id);
  revalidatePath(`/campaigns/${id}`);
  return errs.length ? `Some drafts failed (will retry):\n${errs.join("\n").slice(0, 1500)}` : "5 sample drafts ready";
}

export async function regenerateDraft(messageId: number) {
  const m = await prisma.message.findUnique({ where: { id: messageId } });
  if (!m || m.status !== "ready") return "Only unsent drafts can be regenerated";
  await prisma.message.delete({ where: { id: messageId } });
  await prisma.draftJob.deleteMany({ where: { leadId: m.leadId } });
  const r = await draftForLead(m.leadId);
  revalidatePath(`/campaigns/${m.campaignId}`);
  return r.ok ? "Regenerated" : "Error: " + r.error;
}

export async function startCampaign(id: number) {
  const s = await getSettings();
  const domain = s.domain || s.fromEmail.split("@")[1];
  if (!domain) return "Error: set your domain in Settings";
  const dns = await checkDomain(domain, s.dkimSelector);
  await setState({ dns });
  if (!dns.spf || !dns.dkim) return `Blocked: ${!dns.spf ? "SPF missing. " : ""}${!dns.dkim ? `DKIM missing (selector ${s.dkimSelector}).` : ""}`;
  const samples = await prisma.message.count({ where: { campaignId: id } });
  if (samples < Math.min(5, await prisma.lead.count({ where: { campaignId: id, status: "ready" } }))) return "Error: generate and review the 5 sample drafts first";
  await prisma.campaign.update({ where: { id }, data: { status: "running", samplesApproved: true, startedAt: new Date() } });
  await log("info", "campaign", `campaign ${id} approved and started${s.dryRun ? " (DRY RUN)" : ""}`);
  revalidatePath(`/campaigns/${id}`);
  return s.dryRun ? "Started in DRY-RUN mode (mails go to your test address)" : "Started. The worker sends automatically.";
}

export async function pauseCampaign(id: number) {
  await prisma.campaign.update({ where: { id }, data: { status: "paused" } });
  await log("info", "campaign", `campaign ${id} paused`);
  revalidatePath(`/campaigns/${id}`);
  return "Paused";
}
export async function resumeCampaign(id: number) {
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c?.samplesApproved) return "Error: approve samples first";
  await prisma.campaign.update({ where: { id }, data: { status: "running" } });
  await log("info", "campaign", `campaign ${id} resumed`);
  revalidatePath(`/campaigns/${id}`);
  return "Running (worker respects global stop and alerts)";
}
