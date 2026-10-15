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
import { validateDraft } from "@/lib/validate";

// Every action returns a short Hinglish message for the toast. "Error: …" = failed, "Warning: …" = partly worked.
// The first line becomes the toast title, the rest its text.

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const setLead = (id: string, data: Record<string, unknown>) => C.leads.doc(id).update({ ...data, updatedAt: nowIso() });

/** The draft rules (lib/validate.ts) report in English for the AI; this says the same to the user in Hinglish. */
function draftProblem(e: string) {
  let m: RegExpMatchArray | null;
  if ((m = e.match(/^body has (\d+) words/))) return `Text mein ${m[1]} words hain, 60–110 chahiye`;
  if ((m = e.match(/^ALL CAPS words: (.+)$/))) return `CAPS wale shabd hatao: ${m[1]}`;
  if ((m = e.match(/^language looks like "(\w+)", expected "(\w+)"$/))) return `Mail ${m[2].toUpperCase()} bhasha mein honi chahiye (abhi ${m[1].toUpperCase()} lag rahi hai)`;
  const known: Record<string, string> = {
    "subject empty or too long": "Subject khaali hai ya 90 akshar se lamba hai",
    "fake Re:/Fwd: subject": "Subject 'Re:' ya 'Fwd:' se shuru nahi ho sakta",
    "leftover placeholder": "{{…}} ya [Name] jaisa placeholder bacha hai",
    "link in body (links are only allowed in the signature)": "Text mein link nahi chalega (link sirf signature mein aata hai)",
    urgency: "'Urgent', 'last chance' jaise jaldbaazi wale shabd hatao",
    "hype claim": "'Guarantee', '100%', 'risk-free' jaise daave hatao",
    "repeated punctuation": "'!!' ya '??' mat likho",
    HTML: "HTML tags mat likho, sirf saada text",
    "AI disclaimer": "'As an AI' jaisi line hatao",
    "no question as call to action": "Aakhir mein ek sawaal (?) poochho",
  };
  return Object.hasOwn(known, e) ? known[e] : e;
}
/** "validation: a; b" from the AI pipeline, or a list of rule names, as Hinglish bullet lines. */
const draftProblems = (errors: string[]) => errors.map((e) => "• " + draftProblem(e.trim())).join("\n");
const draftError = (error = "") => (error.startsWith("validation: ") ? draftProblems(error.slice(12).split(";")) : error);

// same rule as addToLedger; tokens pasted from mail clients are cleaned first ("Naam <a@b.com>", mailto:, quotes)
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;
const cleanToken = (t: string) => t.trim().replace(/^mailto:/i, "").replace(/^[<("'[]+|[>)"'\].,;:]+$/g, "").toLowerCase();

// ---------------- settings ----------------
export async function saveSettingsAction(fd: FormData) {
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (k === "sendDays") { out[k] = fd.getAll("sendDays").map(Number); continue; }
    if (k === "dryRun") continue; // only the Dashboard switch changes the mode, never a settings save
    if (typeof def === "boolean") { out[k] = fd.get(k) === "on"; continue; }
    const v = fd.get(k);
    if (v === null) continue;
    out[k] = typeof def === "number" ? Number(v) || 0 : String(v).trim();
  }
  await saveSettings(out as Partial<Settings>);
  await log("info", "settings", "settings saved");
  revalidatePath("/settings");
  return "Settings save ho gayi";
}

export async function testSmtpAction() { try { return await testSmtp(); } catch (e) { return "Error: " + msg(e); } }
export async function testImapAction() { try { return await testImap(); } catch (e) { return "Error: " + msg(e); } }
export async function testMailAction() { try { return await sendTestMail(); } catch (e) { return "Error: " + msg(e); } }
export async function testAiAction() {
  try { const r = await chat([{ role: "user", content: 'Reply with JSON {"ok": true}' }]); return "AI theek chal raha hai\n" + r.slice(0, 100); }
  catch (e) { return "Error: " + msg(e); }
}

export async function dnsAction() {
  const s = await getSettings();
  const domain = s.domain || s.fromEmail.split("@")[1];
  if (!domain) return "Error: Settings mein apna domain ya From address daalo";
  const r = await checkDomain(domain, s.dkimSelector);
  await setState({ dns: r });
  revalidatePath("/settings");
  return `${r.spf && r.dkim ? "DNS theek hai (SPF aur DKIM mil gaye)" : "Error: DNS mein problem hai"}\n${r.detail}`;
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
  return "Saari sending rok di gayi\nKoi mail nahi jayegi jab tak aap Dashboard se stop nahi hatate.";
}
export async function clearStopAction() {
  await setState({ globalStop: false, alert: null });
  await log("info", "control", "global stop / alert cleared (campaigns stay paused until resumed)");
  revalidatePath("/");
  return "Stop / alert hata diya\nAb Campaigns page se campaigns ek-ek karke Resume karo.";
}

// ---------------- leads ----------------
export async function approveLead(id: string) {
  const l = await C.leads.doc(id).get();
  if (l.get("status") !== "needs_review") { revalidatePath("/contacts"); return "Error: Ye contact ab review ke liye nahi ruka hai"; }
  await setLead(id, { status: "ready" });
  await event(id, "approved", "approved after review");
  revalidatePath("/contacts");
  return "Contact approve ho gaya\nAb ye campaign mein mail paa sakta hai.";
}
export async function rejectLead(id: string) {
  const l = await C.leads.doc(id).get();
  if (l.get("status") !== "needs_review") { revalidatePath("/contacts"); return "Error: Ye contact ab review ke liye nahi ruka hai"; }
  await setLead(id, { status: "rejected" });
  await event(id, "rejected", "rejected after review");
  revalidatePath("/contacts");
  return "Contact reject ho gaya\nIs address ko kabhi mail nahi jayegi.";
}
export async function markCheckedSent(id: string) {
  // after manually checking the Sent folder: it went out
  const l = await C.leads.doc(id).get();
  if (l.get("status") !== "check_manual") return "Error: Is contact ka status ab manual check nahi hai";
  await setLead(id, { status: "sent" });
  await C.messages.doc(id).update({ status: "sent", sentAt: nowIso() });
  await C.contacted.doc(key(l.get("email"))).set({ status: "sent", updatedAt: nowIso() }, { merge: true });
  await event(id, "manual", "marked as sent after manual check");
  revalidatePath(`/contacts/${encodeURIComponent(id)}`);
  return "Sent mark ho gaya";
}
export async function markCheckedNotSent(id: string) {
  // it did not go out; it is still never resent automatically (stays in the ledger)
  const l = await C.leads.doc(id).get();
  if (l.get("status") !== "check_manual") return "Error: Is contact ka status ab manual check nahi hai";
  await setLead(id, { status: "failed" });
  await C.messages.doc(id).update({ status: "failed" });
  await C.contacted.doc(key(l.get("email"))).set({ status: "not_sent_checked", updatedAt: nowIso() }, { merge: true });
  await event(id, "manual", "marked as not sent after manual check (never resent automatically)");
  revalidatePath(`/contacts/${encodeURIComponent(id)}`);
  return "Not sent mark ho gaya\nYe mail apne aap kabhi dobara nahi bheji jayegi.";
}

// ---------------- suppression & ledger ----------------
export async function addSuppression(fd: FormData) {
  const raw = String(fd.get("values") || "");
  const reason = String(fd.get("reason") || "manual");
  const values = raw.split(/[\s,;]+/).map((x) => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (!values.length) return "Error: Koi email ya domain nahi mila";
  let added = 0;
  for (const v of values) {
    const kind = v.includes("@") ? "email" : "domain";
    const ref = C.suppression.doc(key(v));
    if (!(await ref.get()).exists) { await ref.set({ value: v, kind, reason, createdAt: nowIso() }); added++; }
    const leads = kind === "email" ? [await C.leads.doc(key(v)).get()] : (await C.leads.where("businessKey", "==", v).get()).docs;
    for (const l of leads) if (l.exists && ["ready", "needs_review"].includes(l.get("status"))) await setLead(l.id, { status: "suppressed" });
  }
  revalidatePath("/suppression");
  const already = values.length - added;
  return `${added} naye address / domain block list mein add hue${already ? `\n${already} pehle se list mein the` : ""}`;
}

export async function addContactedAction(fd: FormData) {
  const tokens = String(fd.get("emails") || "").split(/[\s,;]+/).map(cleanToken).filter(Boolean);
  const emails = tokens.filter((t) => EMAIL.test(t));
  const bad = [...new Set(tokens.filter((t) => t.includes("@") && !EMAIL.test(t)))]; // words without "@" are names, not mistakes
  const r = await addToLedger(emails, "manual", String(fd.get("note") || "") || undefined);
  revalidatePath("/ledger");
  if (!r.added && !r.alreadyThere) return `Error: Koi sahi email address nahi mila\nAddress aise likho: naam@company.com${bad.length ? `\nGalat lage: ${bad.slice(0, 5).join(", ")}` : ""}`;
  if (bad.length) return `Warning: ${r.added} address add hue, ${r.alreadyThere} pehle se the\nYe sahi email nahi lage, isliye chhod diye (theek karke dobara daalo): ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? ` aur ${bad.length - 5} aur` : ""}`;
  return `${r.added} address ledger mein add hue\n${r.alreadyThere} pehle se ledger mein the. In sabko ab kabhi cold mail nahi jayegi.`;
}

export async function importSentAction() {
  try { const r = await importSentFolder(); revalidatePath("/ledger"); return r; }
  catch (e) { return `Error: Sent folder nahi padh paye\n${msg(e)}\nSettings mein "IMAP test" chala ke check karo.`; }
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
  // with no Ready lead generateSamples has nothing to do: say so instead of reporting success
  if (!(await count(C.leads.where("campaignId", "==", id).where("status", "==", "ready")))) {
    return "Error: Is campaign mein koi Ready lead nahi hai\nPehle Contacts mein 'Review chahiye' wale leads approve karo, phir samples banao.";
  }
  const errs = await generateSamples(id);
  const made = await count(C.messages.where("campaignId", "==", id));
  revalidatePath(`/campaigns/${id}`);
  return errs.length
    ? `Warning: ${errs.length} sample draft nahi ban paye\nSamples apne aap dobara nahi bante: '5 sample drafts banao' phir se dabao, sirf bache hue banenge.\n${errs.map((e) => { const i = e.indexOf(": "); return i > 0 ? `${e.slice(0, i)}:\n${draftError(e.slice(i + 2))}` : e; }).join("\n").slice(0, 1500)}`
    : `${made} sample draft${made === 1 ? "" : "s"} taiyaar\nNeeche padho, theek lagein to 'approve karke start karo' dabao.`;
}

export async function regenerateDraft(messageId: string) {
  const ref = C.messages.doc(messageId);
  const m = await ref.get();
  if (!m.exists || m.get("status") !== "ready") return "Error: Sirf na bheji gayi draft ka naya version ban sakta hai";
  await ref.delete();
  await C.leads.doc(messageId).update({ hasMessage: false });
  await C.draftJobs.doc(messageId).delete().catch(() => {});
  const r = await draftForLead(messageId);
  revalidatePath(`/campaigns/${m.get("campaignId")}`);
  revalidatePath("/review");
  return r.ok
    ? "Naya version ban gaya\nPadh ke approve karo."
    : `Error: Naya version nahi ban paya\nPurani draft hat chuki hai. Campaign chal raha ho to worker thodi der mein nayi draft banayega; samples ke liye Campaign page pe '5 sample drafts banao' dabao.\n${draftError(r.error)}`;
}

export async function startCampaign(id: string) {
  const s = await getSettings();
  const domain = s.domain || s.fromEmail.split("@")[1];
  if (!domain) return "Error: Settings mein apna domain daalo";
  const dns = await checkDomain(domain, s.dkimSelector);
  await setState({ dns });
  if (!dns.spf || !dns.dkim) return `Error: Campaign start nahi hua. ${!dns.spf ? "SPF missing hai. " : ""}${!dns.dkim ? `DKIM missing hai (selector ${s.dkimSelector}).` : ""}`;
  const drafts = await count(C.messages.where("campaignId", "==", id));
  const ready = await count(C.leads.where("campaignId", "==", id).where("status", "==", "ready"));
  if (drafts < Math.min(5, ready)) return "Error: Pehle 5 sample drafts banao aur padho";
  await C.campaigns.doc(id).update({ status: "running", samplesApproved: true, startedAt: nowIso() });
  // the samples I just read count as approved
  const samples = await C.messages.where("campaignId", "==", id).where("status", "==", "ready").get();
  for (const m of samples.docs) if (!m.get("approved")) await m.ref.update({ approved: true, approvedAt: nowIso() });
  await log("info", "campaign", `campaign ${id} approved and started${s.dryRun ? " (DRY RUN)" : ""}`);
  revalidatePath(`/campaigns/${id}`);
  return s.dryRun
    ? "Campaign DRY-RUN mein start ho gaya\nMails sirf aapke test address pe jayengi. Nayi drafts Approve page pe aayengi."
    : "Campaign start ho gaya\nWorker sending window mein apne aap bhejega. Nayi drafts Approve page pe aayengi.";
}

export async function pauseCampaign(id: string) {
  await C.campaigns.doc(id).update({ status: "paused" });
  await log("info", "campaign", `campaign ${id} paused`);
  revalidatePath(`/campaigns/${id}`);
  return "Campaign ruk gaya\nResume dabane tak is campaign se koi mail nahi jayegi.";
}
export async function resumeCampaign(id: string) {
  const c = await C.campaigns.doc(id).get();
  if (!c.get("samplesApproved")) return "Error: Pehle samples approve karo";
  await c.ref.update({ status: "running" });
  await log("info", "campaign", `campaign ${id} resumed`);
  revalidatePath(`/campaigns/${id}`);
  return "Campaign fir se chal raha hai\nSTOP aur alerts ka dhyan apne aap rakha jayega.";
}

// ---------------- mode switch (Dashboard only) ----------------
export async function setModeAction(live: boolean) {
  const s = await getSettings();
  if (live && !s.testEmail) return "Error: Pehle Settings mein apna test address daalo";
  await saveSettings({ dryRun: !live });
  await log("warn", "control", live ? "LIVE mode switched ON: approved mails now go to real leads" : "back to DRY-RUN mode");
  revalidatePath("/");
  return live ? "LIVE mode on ho gaya\nApprove ki hui mails ab asli leads ko jayengi." : "DRY-RUN mode on ho gaya\nMails ab sirf aapke test address pe jayengi.";
}

// ---------------- per-mail approval ----------------
async function approveOne(id: string) {
  const ref = C.messages.doc(id);
  const m = await ref.get();
  if (!m.exists || m.get("status") !== "ready") return false;
  await ref.update({ approved: true, approvedAt: nowIso() });
  await event(id, "approved_mail", "mail approved for sending");
  return true;
}

export async function approveMessage(id: string) {
  const ok = await approveOne(id);
  revalidatePath("/review");
  return ok ? "Mail approve ho gayi\nSending window khulte hi worker ise bhej dega." : "Error: Ye mail ab approval ke liye nahi ruki hai";
}

export async function approveAllShown(ids: string[]) {
  let n = 0;
  for (const id of ids) if (await approveOne(id)) n++;
  revalidatePath("/review");
  return `${n} mails approve ho gayi\nSending window mein worker inhe ek-ek karke bhejega.`;
}

export async function rejectMessage(id: string) {
  const ref = C.messages.doc(id);
  const m = await ref.get();
  if (!m.exists || m.get("status") !== "ready") return "Error: Ye mail ab approval ke liye nahi ruki hai";
  await ref.update({ status: "rejected", approved: false });
  await setLead(id, { status: "rejected" });
  await event(id, "rejected_mail", "mail rejected: this lead will not be emailed");
  revalidatePath("/review");
  return "Mail reject ho gayi\nIs lead ko kabhi mail nahi jayegi.";
}

export async function saveDraftEdit(id: string, fd: FormData) {
  const ref = C.messages.doc(id);
  const m = await ref.get();
  if (!m.exists || m.get("status") !== "ready") return "Error: Ye draft ab edit nahi ho sakta";
  const subject = String(fd.get("subject") || "").trim();
  const body = String(fd.get("body") || "").replace(/\r/g, "").trim();
  const errors = validateDraft(subject, body, m.get("language"), m.get("businessName") || "");
  if (errors.length) return "Error: Edit save nahi hua\n" + draftProblems(errors);
  await ref.update({ subject, body, subjectEn: null, bodyEn: null, edited: true, approved: false, approvedAt: null });
  await event(id, "edited", "draft edited by hand");
  revalidatePath("/review");
  return "Edit save ho gaya\nEk baar aur padh lo, phir approve karo.";
}
