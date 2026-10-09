"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { C, db, key, nowIso, count } from "@/lib/fsdb";
import { getSettings, saveSettings, setState, DEFAULTS, type Settings } from "@/lib/settings";
import { testSmtp, testImap, sendTestMail } from "@/lib/mailer";
import { checkDomain } from "@/lib/dnscheck";
import { generateSamples, draftForLead } from "@/lib/drafts";
import { syncInbox } from "@/lib/inbox";
import { addToLedger, importSentFolder } from "@/lib/ledger";
import { log, event } from "@/lib/log";
import { chat } from "@/lib/ai";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const setLead = (id: string, data: Record<string, unknown>) => C.leads.doc(id).update({ ...data, updatedAt: nowIso() });

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
  const running = await C.campaigns.where("status", "==", "running").get();
  await Promise.all(running.docs.map((d) => d.ref.update({ status: "paused" })));
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
export async function approveLead(id: string) {
  const l = await C.leads.doc(id).get();
  if (l.get("status") === "needs_review") { await setLead(id, { status: "ready" }); await event(id, "approved", "approved after review"); }
  revalidatePath("/contacts");
}
export async function rejectLead(id: string) {
  const l = await C.leads.doc(id).get();
  if (l.get("status") === "needs_review") { await setLead(id, { status: "rejected" }); await event(id, "rejected", "rejected after review"); }
  revalidatePath("/contacts");
}
export async function markCheckedSent(id: string) {
  // after manually checking the Sent folder: it went out
  const l = await C.leads.doc(id).get();
  if (l.get("status") !== "check_manual") return;
  await setLead(id, { status: "sent" });
  await C.messages.doc(id).update({ status: "sent", sentAt: nowIso() });
  await C.contacted.doc(key(l.get("email"))).set({ status: "sent", updatedAt: nowIso() }, { merge: true });
  await event(id, "manual", "marked as sent after manual check");
  revalidatePath(`/contacts/${encodeURIComponent(id)}`);
}
export async function markCheckedNotSent(id: string) {
  // it did not go out; it is still never resent automatically (stays in the ledger)
  const l = await C.leads.doc(id).get();
  if (l.get("status") !== "check_manual") return;
  await setLead(id, { status: "failed" });
  await C.messages.doc(id).update({ status: "failed" });
  await C.contacted.doc(key(l.get("email"))).set({ status: "not_sent_checked", updatedAt: nowIso() }, { merge: true });
  await event(id, "manual", "marked as not sent after manual check (never resent automatically)");
  revalidatePath(`/contacts/${encodeURIComponent(id)}`);
}

// ---------------- suppression & ledger ----------------
export async function addSuppression(fd: FormData) {
  const raw = String(fd.get("values") || "");
  const reason = String(fd.get("reason") || "manual");
  for (const v of raw.split(/[\s,;]+/).map((x) => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean)) {
    const kind = v.includes("@") ? "email" : "domain";
    const ref = C.suppression.doc(key(v));
    if (!(await ref.get()).exists) await ref.set({ value: v, kind, reason, createdAt: nowIso() });
    const leads = kind === "email" ? [await C.leads.doc(key(v)).get()] : (await C.leads.where("businessKey", "==", v).get()).docs;
    for (const l of leads) if (l.exists && ["ready", "needs_review"].includes(l.get("status"))) await setLead(l.id, { status: "suppressed" });
  }
  revalidatePath("/suppression");
}

export async function addContactedAction(fd: FormData) {
  const emails = String(fd.get("emails") || "").split(/[\s,;]+/);
  const r = await addToLedger(emails, "manual", String(fd.get("note") || "") || undefined);
  revalidatePath("/ledger");
  return `${r.added} added to the contacted ledger, ${r.alreadyThere} were already there`;
}

export async function importSentAction() {
  try { const r = await importSentFolder(); revalidatePath("/ledger"); return r; } catch (e) { return "Error: " + msg(e); }
}

// ---------------- campaigns ----------------
export async function createCampaign(fd: FormData) {
  const listId = String(fd.get("listId"));
  const ref = await C.campaigns.add({
    name: String(fd.get("name") || "Campaign"), listId, timezone: String(fd.get("timezone")), language: String(fd.get("language")),
    status: "draft", samplesApproved: false, createdAt: nowIso(),
  });
  // attach every unassigned lead of the list (ready or still needing review)
  const leads = (await C.leads.where("listId", "==", listId).get()).docs.filter((d) => !d.get("campaignId") && ["ready", "needs_review"].includes(d.get("status")));
  for (let i = 0; i < leads.length; i += 400) {
    const b = db.batch();
    for (const l of leads.slice(i, i + 400)) b.update(l.ref, { campaignId: ref.id, updatedAt: nowIso() });
    await b.commit();
  }
  await log("info", "campaign", `campaign "${fd.get("name")}" created with ${leads.length} leads`);
  redirect(`/campaigns/${ref.id}`);
}

export async function samplesAction(id: string) {
  const errs = await generateSamples(id);
  revalidatePath(`/campaigns/${id}`);
  return errs.length ? `Some drafts failed (will retry):\n${errs.join("\n").slice(0, 1500)}` : "5 sample drafts ready";
}

export async function regenerateDraft(messageId: string) {
  const ref = C.messages.doc(messageId);
  const m = await ref.get();
  if (!m.exists || m.get("status") !== "ready") return "Only unsent drafts can be regenerated";
  await ref.delete();
  await C.leads.doc(messageId).update({ hasMessage: false });
  await C.draftJobs.doc(messageId).delete().catch(() => {});
  const r = await draftForLead(messageId);
  revalidatePath(`/campaigns/${m.get("campaignId")}`);
  return r.ok ? "Regenerated" : "Error: " + r.error;
}

export async function startCampaign(id: string) {
  const s = await getSettings();
  const domain = s.domain || s.fromEmail.split("@")[1];
  if (!domain) return "Error: set your domain in Settings";
  const dns = await checkDomain(domain, s.dkimSelector);
  await setState({ dns });
  if (!dns.spf || !dns.dkim) return `Blocked: ${!dns.spf ? "SPF missing. " : ""}${!dns.dkim ? `DKIM missing (selector ${s.dkimSelector}).` : ""}`;
  const drafts = await count(C.messages.where("campaignId", "==", id));
  const ready = await count(C.leads.where("campaignId", "==", id).where("status", "==", "ready"));
  if (drafts < Math.min(5, ready)) return "Error: generate and review the 5 sample drafts first";
  await C.campaigns.doc(id).update({ status: "running", samplesApproved: true, startedAt: nowIso() });
  await log("info", "campaign", `campaign ${id} approved and started${s.dryRun ? " (DRY RUN)" : ""}`);
  revalidatePath(`/campaigns/${id}`);
  return s.dryRun ? "Started in DRY-RUN mode (mails go to your test address)" : "Started. The worker sends automatically.";
}

export async function pauseCampaign(id: string) {
  await C.campaigns.doc(id).update({ status: "paused" });
  await log("info", "campaign", `campaign ${id} paused`);
  revalidatePath(`/campaigns/${id}`);
  return "Paused";
}
export async function resumeCampaign(id: string) {
  const c = await C.campaigns.doc(id).get();
  if (!c.get("samplesApproved")) return "Error: approve samples first";
  await c.ref.update({ status: "running" });
  await log("info", "campaign", `campaign ${id} resumed`);
  revalidatePath(`/campaigns/${id}`);
  return "Running (worker respects global stop and alerts)";
}
