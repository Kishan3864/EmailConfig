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
import { MAIL_TYPES } from "@/lib/templates";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";

// Every action returns a short message for the toast, in the user's UI language (Hinglish or English).
// "Error: …" = failed, "Warning: …" = partly worked (the prefix stays English in both languages).
// The first line becomes the toast title, the rest its text.

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const setLead = (id: string, data: Record<string, unknown>) => C.leads.doc(id).update({ ...data, updatedAt: nowIso() });

/** The draft rules (lib/validate.ts) report in English for the AI; this says the same to the user. */
function draftProblem(e: string, t: T) {
  let m: RegExpMatchArray | null;
  if ((m = e.match(/^body has (\d+) words/))) return t(`Text mein ${m[1]} words hain, 60–110 chahiye`, `The text has ${m[1]} words, it needs 60–110`);
  if ((m = e.match(/^ALL CAPS words: (.+)$/))) return t(`CAPS wale shabd hatao: ${m[1]}`, `Remove the ALL CAPS words: ${m[1]}`);
  if ((m = e.match(/^language looks like "(\w+)", expected "(\w+)"$/))) {
    const [want, now] = [m[2].toUpperCase(), m[1].toUpperCase()];
    return t(`Mail ${want} bhasha mein honi chahiye (abhi ${now} lag rahi hai)`, `The mail must be in ${want} (it looks like ${now} now)`);
  }
  const known: Record<string, [string, string]> = {
    "subject empty or too long": ["Subject khaali hai ya 90 akshar se lamba hai", "The subject is empty or longer than 90 characters"],
    "fake Re:/Fwd: subject": ["Subject 'Re:' ya 'Fwd:' se shuru nahi ho sakta", "The subject cannot start with 'Re:' or 'Fwd:'"],
    "leftover placeholder": ["{{…}} ya [Name] jaisa placeholder bacha hai", "A placeholder like {{…}} or [Name] is left in the text"],
    "link in body (links are only allowed in the signature)": ["Text mein link nahi chalega (link sirf signature mein aata hai)", "No links in the text (links only go in the signature)"],
    urgency: ["'Urgent', 'last chance' jaise jaldbaazi wale shabd hatao", "Remove pushy words like 'urgent' or 'last chance'"],
    "hype claim": ["'Guarantee', '100%', 'risk-free' jaise daave hatao", "Remove claims like 'guarantee', '100%' or 'risk-free'"],
    "repeated punctuation": ["'!!' ya '??' mat likho", "Do not write '!!' or '??'"],
    HTML: ["HTML tags mat likho, sirf saada text", "No HTML tags, plain text only"],
    "AI disclaimer": ["'As an AI' jaisi line hatao", "Remove lines like 'As an AI'"],
    "no question as call to action": ["Aakhir mein ek sawaal (?) poochho", "End with a question (?)"],
  };
  return Object.hasOwn(known, e) ? t(...known[e]) : e;
}
/** A list of rule names as bullet lines. */
const draftProblems = (errors: string[], t: T) => errors.map((e) => "• " + draftProblem(e.trim(), t)).join("\n");
/** "validation: a; b" from the AI pipeline as bullet lines; other errors as they are. */
const draftError = (t: T, error = "") => (error.startsWith("validation: ") ? draftProblems(error.slice(12).split(";"), t) : error);

// same rule as addToLedger; tokens pasted from mail clients are cleaned first ("Naam <a@b.com>", mailto:, quotes)
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;
const cleanToken = (s: string) => s.trim().replace(/^mailto:/i, "").replace(/^[<("'[]+|[>)"'\].,;:]+$/g, "").toLowerCase();

// ---------------- settings ----------------
export async function saveSettingsAction(fd: FormData) {
  const { t } = await getT();
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
  return t("Settings save ho gayi", "Settings saved");
}

// the mailer, inbox and ledger helpers answer in English (they are shared with the worker); the UI shows them in its language
export async function testSmtpAction() {
  const { t } = await getT();
  try { await testSmtp(); return t("SMTP theek hai: login ho gaya", "SMTP OK: login accepted"); }
  catch (e) { return "Error: " + msg(e); }
}
export async function testImapAction() {
  const { t } = await getT();
  try {
    const r = await testImap();
    const m = r.match(/^IMAP OK: (\d+) folders \(([\s\S]*)\)$/);
    return m ? t(`IMAP theek hai: ${m[1]} folders mile\n(${m[2]})`, `IMAP OK: ${m[1]} folders found\n(${m[2]})`) : r;
  } catch (e) { return "Error: " + msg(e); }
}
export async function testMailAction() {
  const { t } = await getT();
  try {
    const r = await sendTestMail();
    const m = r.match(/^Sent to (.+?): ([\s\S]*)$/);
    return m ? t(`Test mail ${m[1]} pe bhej di\nServer ka jawab: ${m[2]}`, `Test mail sent to ${m[1]}\nServer reply: ${m[2]}`) : r;
  } catch (e) {
    const em = msg(e);
    return "Error: " + (em === "Set your test address first" ? t("Pehle Settings mein apna test address daalo", "Set your test address in Settings first") : em);
  }
}
export async function testAiAction() {
  const { t } = await getT();
  try { const r = await chat([{ role: "user", content: 'Reply with JSON {"ok": true}' }]); return t("AI theek chal raha hai", "AI is working") + "\n" + r.slice(0, 100); }
  catch (e) { return "Error: " + msg(e); }
}

export async function dnsAction() {
  const { t } = await getT();
  const s = await getSettings();
  const domain = s.domain || s.fromEmail.split("@")[1];
  if (!domain) return t("Error: Settings mein apna domain ya From address daalo", "Error: Add your domain or From address in Settings");
  const r = await checkDomain(domain, s.dkimSelector);
  await setState({ dns: r });
  revalidatePath("/settings");
  return `${r.spf && r.dkim ? t("DNS theek hai (SPF aur DKIM mil gaye)", "DNS OK (SPF and DKIM found)") : t("Error: DNS mein problem hai", "Error: DNS has a problem")}\n${r.detail}`;
}

export async function syncNowAction() {
  const { t } = await getT();
  try {
    const r = await syncInbox();
    if (r === "imap not configured") return t("Error: IMAP set nahi hai (From address ya password missing)", "Error: IMAP is not set up (From address or password missing)");
    const m = r.match(/^processed (\d+)$/);
    return m ? t(`Inbox sync ho gaya\n${m[1]} naye mail process hue`, `Inbox synced\n${m[1]} new mails processed`) : r;
  } catch (e) { return "Error: " + msg(e); }
}

// ---------------- global controls ----------------
export async function globalStopAction() {
  const { t } = await getT();
  await setState({ globalStop: true });
  const running = await C.campaigns.where("status", "==", "running").get();
  await Promise.all(running.docs.map((d) => d.ref.update({ status: "paused" })));
  await log("warn", "control", "GLOBAL STOP pressed");
  revalidatePath("/");
  return t("Saari sending rok di gayi\nKoi mail nahi jayegi jab tak aap Dashboard se stop nahi hatate.", "All sending stopped\nNo mail goes out until you clear the stop on the Dashboard.");
}
export async function clearStopAction() {
  const { t } = await getT();
  await setState({ globalStop: false, alert: null });
  await log("info", "control", "global stop / alert cleared (campaigns stay paused until resumed)");
  revalidatePath("/");
  return t("Stop / alert hata diya\nAb Campaigns page se campaigns ek-ek karke Resume karo.", "Stop / alert cleared\nNow resume the campaigns one by one on the Campaigns page.");
}

// ---------------- leads ----------------
export async function approveLead(id: string) {
  const { t } = await getT();
  const l = await C.leads.doc(id).get();
  if (l.get("status") !== "needs_review") { revalidatePath("/contacts"); return t("Error: Ye contact ab review ke liye nahi ruka hai", "Error: This contact is no longer waiting for review"); }
  await setLead(id, { status: "ready" });
  await event(id, "approved", "approved after review");
  revalidatePath("/contacts");
  return t("Contact approve ho gaya\nAb ye campaign mein mail paa sakta hai.", "Contact approved\nIt can now get a mail in a campaign.");
}
export async function rejectLead(id: string) {
  const { t } = await getT();
  const l = await C.leads.doc(id).get();
  if (l.get("status") !== "needs_review") { revalidatePath("/contacts"); return t("Error: Ye contact ab review ke liye nahi ruka hai", "Error: This contact is no longer waiting for review"); }
  await setLead(id, { status: "rejected" });
  await event(id, "rejected", "rejected after review");
  revalidatePath("/contacts");
  return t("Contact reject ho gaya\nIs address ko kabhi mail nahi jayegi.", "Contact rejected\nThis address will never be emailed.");
}
export async function markCheckedSent(id: string) {
  const { t } = await getT();
  // after manually checking the Sent folder: it went out
  const l = await C.leads.doc(id).get();
  if (l.get("status") !== "check_manual") return t("Error: Is contact ka status ab manual check nahi hai", "Error: This contact no longer needs a manual check");
  await setLead(id, { status: "sent" });
  await C.messages.doc(id).update({ status: "sent", sentAt: nowIso() });
  await C.contacted.doc(key(l.get("email"))).set({ status: "sent", updatedAt: nowIso() }, { merge: true });
  await event(id, "manual", "marked as sent after manual check");
  revalidatePath(`/contacts/${encodeURIComponent(id)}`);
  return t("Sent mark ho gaya", "Marked as sent");
}
export async function markCheckedNotSent(id: string) {
  const { t } = await getT();
  // it did not go out; it is still never resent automatically (stays in the ledger)
  const l = await C.leads.doc(id).get();
  if (l.get("status") !== "check_manual") return t("Error: Is contact ka status ab manual check nahi hai", "Error: This contact no longer needs a manual check");
  await setLead(id, { status: "failed" });
  await C.messages.doc(id).update({ status: "failed" });
  await C.contacted.doc(key(l.get("email"))).set({ status: "not_sent_checked", updatedAt: nowIso() }, { merge: true });
  await event(id, "manual", "marked as not sent after manual check (never resent automatically)");
  revalidatePath(`/contacts/${encodeURIComponent(id)}`);
  return t("Not sent mark ho gaya\nYe mail apne aap kabhi dobara nahi bheji jayegi.", "Marked as not sent\nThis mail will never be sent again automatically.");
}

// ---------------- suppression & ledger ----------------
export async function addSuppression(fd: FormData) {
  const { t } = await getT();
  const raw = String(fd.get("values") || "");
  const reason = String(fd.get("reason") || "manual");
  const values = raw.split(/[\s,;]+/).map((x) => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (!values.length) return t("Error: Koi email ya domain nahi mila", "Error: No email or domain found");
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
  return t(
    `${added} naye address / domain block list mein add hue${already ? `\n${already} pehle se list mein the` : ""}`,
    `${added} new addresses / domains added to the block list${already ? `\n${already} were already on the list` : ""}`,
  );
}

export async function addContactedAction(fd: FormData) {
  const { t } = await getT();
  const tokens = String(fd.get("emails") || "").split(/[\s,;]+/).map(cleanToken).filter(Boolean);
  const emails = tokens.filter((x) => EMAIL.test(x));
  const bad = [...new Set(tokens.filter((x) => x.includes("@") && !EMAIL.test(x)))]; // words without "@" are names, not mistakes
  const r = await addToLedger(emails, "manual", String(fd.get("note") || "") || undefined);
  revalidatePath("/ledger");
  const badList = bad.slice(0, 5).join(", ");
  if (!r.added && !r.alreadyThere) {
    return t(
      `Error: Koi sahi email address nahi mila\nAddress aise likho: naam@company.com${bad.length ? `\nGalat lage: ${badList}` : ""}`,
      `Error: No valid email address found\nWrite addresses like name@company.com${bad.length ? `\nLooks wrong: ${badList}` : ""}`,
    );
  }
  if (bad.length) {
    const more = bad.length > 5 ? bad.length - 5 : 0;
    return t(
      `Warning: ${r.added} address add hue, ${r.alreadyThere} pehle se the\nYe sahi email nahi lage, isliye chhod diye (theek karke dobara daalo): ${badList}${more ? ` aur ${more} aur` : ""}`,
      `Warning: ${r.added} addresses added, ${r.alreadyThere} were already there\nThese did not look like valid emails, so they were skipped (fix them and add again): ${badList}${more ? ` and ${more} more` : ""}`,
    );
  }
  return t(
    `${r.added} address ledger mein add hue\n${r.alreadyThere} pehle se ledger mein the. In sabko ab kabhi cold mail nahi jayegi.`,
    `${r.added} addresses added to the ledger\n${r.alreadyThere} were already in the ledger. None of them will ever get a cold mail.`,
  );
}

export async function importSentAction() {
  const { t } = await getT();
  try {
    const r = await importSentFolder();
    revalidatePath("/ledger");
    const m = r.match(/^Sent folder: (\d+) recipients found, (\d+) added to the contacted ledger \((\d+) were already there\)$/);
    return m ? t(`Sent folder mein ${m[1]} address mile\n${m[2]} ledger mein add hue, ${m[3]} pehle se the.`, `Found ${m[1]} addresses in the Sent folder\n${m[2]} added to the ledger, ${m[3]} were already there.`) : r;
  } catch (e) {
    const em = msg(e) === "Sent folder not found" ? t("Mailbox mein Sent folder nahi mila", "No Sent folder found in the mailbox") : msg(e);
    return t(`Error: Sent folder nahi padh paye\n${em}\nSettings mein "IMAP test" chala ke check karo.`, `Error: Could not read the Sent folder\n${em}\nRun "IMAP test" in Settings to check.`);
  }
}

// ---------------- campaigns ----------------
export async function createCampaign(fd: FormData) {
  const listId = String(fd.get("listId"));
  const mailType = String(fd.get("mailType") || "ai");
  const ref = await C.campaigns.add({
    name: String(fd.get("name") || "Campaign"), listId, timezone: String(fd.get("timezone")), language: String(fd.get("language")),
    mailType: (MAIL_TYPES as readonly string[]).includes(mailType) ? mailType : "ai",
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
  const { t } = await getT();
  // with no Ready lead generateSamples has nothing to do: say so instead of reporting success
  if (!(await count(C.leads.where("campaignId", "==", id).where("status", "==", "ready")))) {
    return t(
      "Error: Is campaign mein koi Ready lead nahi hai\nPehle Contacts mein 'Review chahiye' wale leads approve karo, phir samples banao.",
      "Error: This campaign has no Ready lead\nFirst approve the 'Needs review' leads in Contacts, then make the samples.",
    );
  }
  const errs = await generateSamples(id);
  const made = await count(C.messages.where("campaignId", "==", id));
  revalidatePath(`/campaigns/${id}`);
  if (errs.length) {
    const detail = errs.map((e) => { const i = e.indexOf(": "); return i > 0 ? `${e.slice(0, i)}:\n${draftError(t, e.slice(i + 2))}` : e; }).join("\n").slice(0, 1500);
    return t(
      `Warning: ${errs.length} sample draft nahi ban paye\nSamples apne aap dobara nahi bante: '5 sample drafts banao' phir se dabao, sirf bache hue banenge.\n${detail}`,
      `Warning: ${errs.length} sample drafts could not be made\nSamples are not retried automatically: press 'Make 5 sample drafts' again, only the missing ones are made.\n${detail}`,
    );
  }
  return t(
    `${made} sample draft${made === 1 ? "" : "s"} taiyaar\nNeeche padho, theek lagein to 'approve karke start karo' dabao.`,
    `${made} sample draft${made === 1 ? "" : "s"} ready\nRead them below; if they look good, press 'approve and start'.`,
  );
}

export async function regenerateDraft(messageId: string) {
  const { t } = await getT();
  const ref = C.messages.doc(messageId);
  const m = await ref.get();
  if (!m.exists || m.get("status") !== "ready") return t("Error: Sirf na bheji gayi draft ka naya version ban sakta hai", "Error: Only an unsent draft can get a new version");
  await ref.delete();
  await C.leads.doc(messageId).update({ hasMessage: false });
  await C.draftJobs.doc(messageId).delete().catch(() => {});
  const r = await draftForLead(messageId);
  revalidatePath(`/campaigns/${m.get("campaignId")}`);
  revalidatePath("/review");
  return r.ok
    ? t("Naya version ban gaya\nPadh ke approve karo.", "New version ready\nRead it, then approve.")
    : t(
      `Error: Naya version nahi ban paya\nPurani draft hat chuki hai. Campaign chal raha ho to worker thodi der mein nayi draft banayega; samples ke liye Campaign page pe '5 sample drafts banao' dabao.\n${draftError(t, r.error)}`,
      `Error: Could not write a new version\nThe old draft is gone. If the campaign is running, the worker writes a new draft shortly; for samples press 'Make 5 sample drafts' on the Campaign page.\n${draftError(t, r.error)}`,
    );
}

export async function startCampaign(id: string) {
  const { t } = await getT();
  const s = await getSettings();
  const domain = s.domain || s.fromEmail.split("@")[1];
  if (!domain) return t("Error: Settings mein apna domain daalo", "Error: Add your domain in Settings");
  const dns = await checkDomain(domain, s.dkimSelector);
  await setState({ dns });
  if (!dns.spf || !dns.dkim) {
    return t(
      `Error: Campaign start nahi hua. ${!dns.spf ? "SPF missing hai. " : ""}${!dns.dkim ? `DKIM missing hai (selector ${s.dkimSelector}).` : ""}`,
      `Error: The campaign did not start. ${!dns.spf ? "SPF is missing. " : ""}${!dns.dkim ? `DKIM is missing (selector ${s.dkimSelector}).` : ""}`,
    );
  }
  const drafts = await count(C.messages.where("campaignId", "==", id));
  const ready = await count(C.leads.where("campaignId", "==", id).where("status", "==", "ready"));
  if (drafts < Math.min(5, ready)) return t("Error: Pehle 5 sample drafts banao aur padho", "Error: First make and read the 5 sample drafts");
  await C.campaigns.doc(id).update({ status: "running", samplesApproved: true, startedAt: nowIso() });
  // the samples I just read count as approved
  const samples = await C.messages.where("campaignId", "==", id).where("status", "==", "ready").get();
  for (const m of samples.docs) if (!m.get("approved")) await m.ref.update({ approved: true, approvedAt: nowIso() });
  await log("info", "campaign", `campaign ${id} approved and started${s.dryRun ? " (DRY RUN)" : ""}`);
  revalidatePath(`/campaigns/${id}`);
  return s.dryRun
    ? t("Campaign DRY-RUN mein start ho gaya\nMails sirf aapke test address pe jayengi. Nayi drafts Approve page pe aayengi.", "Campaign started in DRY-RUN\nMails only go to your test address. New drafts will appear on the Approve page.")
    : t("Campaign start ho gaya\nWorker sending window mein apne aap bhejega. Nayi drafts Approve page pe aayengi.", "Campaign started\nThe worker sends automatically in the sending window. New drafts will appear on the Approve page.");
}

export async function pauseCampaign(id: string) {
  const { t } = await getT();
  await C.campaigns.doc(id).update({ status: "paused" });
  await log("info", "campaign", `campaign ${id} paused`);
  revalidatePath(`/campaigns/${id}`);
  return t("Campaign ruk gaya\nResume dabane tak is campaign se koi mail nahi jayegi.", "Campaign paused\nNo mail goes out from this campaign until you press Resume.");
}
export async function resumeCampaign(id: string) {
  const { t } = await getT();
  const c = await C.campaigns.doc(id).get();
  if (!c.get("samplesApproved")) return t("Error: Pehle samples approve karo", "Error: Approve the samples first");
  await c.ref.update({ status: "running" });
  await log("info", "campaign", `campaign ${id} resumed`);
  revalidatePath(`/campaigns/${id}`);
  return t("Campaign fir se chal raha hai\nSTOP aur alerts ka dhyan apne aap rakha jayega.", "Campaign running again\nSTOP and alerts are still respected automatically.");
}

// ---------------- mode switch (Dashboard only) ----------------
export async function setModeAction(live: boolean) {
  const { t } = await getT();
  const s = await getSettings();
  if (live && !s.testEmail) return t("Error: Pehle Settings mein apna test address daalo", "Error: Set your test address in Settings first");
  await saveSettings({ dryRun: !live });
  await log("warn", "control", live ? "LIVE mode switched ON: approved mails now go to real leads" : "back to DRY-RUN mode");
  revalidatePath("/");
  return live
    ? t("LIVE mode on ho gaya\nApprove ki hui mails ab asli leads ko jayengi.", "LIVE mode is on\nApproved mails now go to real leads.")
    : t("DRY-RUN mode on ho gaya\nMails ab sirf aapke test address pe jayengi.", "DRY-RUN mode is on\nMails now only go to your test address.");
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
  const { t } = await getT();
  const ok = await approveOne(id);
  revalidatePath("/review");
  return ok
    ? t("Mail approve ho gayi\nSending window khulte hi worker ise bhej dega.", "Mail approved\nThe worker sends it as soon as the sending window opens.")
    : t("Error: Ye mail ab approval ke liye nahi ruki hai", "Error: This mail is no longer waiting for approval");
}

export async function approveAllShown(ids: string[]) {
  const { t } = await getT();
  let n = 0;
  for (const id of ids) if (await approveOne(id)) n++;
  revalidatePath("/review");
  return t(`${n} mails approve ho gayi\nSending window mein worker inhe ek-ek karke bhejega.`, `${n} mails approved\nThe worker sends them one by one in the sending window.`);
}

export async function rejectMessage(id: string) {
  const { t } = await getT();
  const ref = C.messages.doc(id);
  const m = await ref.get();
  if (!m.exists || m.get("status") !== "ready") return t("Error: Ye mail ab approval ke liye nahi ruki hai", "Error: This mail is no longer waiting for approval");
  await ref.update({ status: "rejected", approved: false });
  await setLead(id, { status: "rejected" });
  await event(id, "rejected_mail", "mail rejected: this lead will not be emailed");
  revalidatePath("/review");
  return t("Mail reject ho gayi\nIs lead ko kabhi mail nahi jayegi.", "Mail rejected\nThis lead will never be emailed.");
}

export async function saveDraftEdit(id: string, fd: FormData) {
  const { t } = await getT();
  const ref = C.messages.doc(id);
  const m = await ref.get();
  if (!m.exists || m.get("status") !== "ready") return t("Error: Ye draft ab edit nahi ho sakta", "Error: This draft can no longer be edited");
  const subject = String(fd.get("subject") || "").trim();
  const body = String(fd.get("body") || "").replace(/\r/g, "").trim();
  const errors = validateDraft(subject, body, m.get("language"), m.get("businessName") || "");
  if (errors.length) return t("Error: Edit save nahi hua\n", "Error: Edit not saved\n") + draftProblems(errors, t);
  await ref.update({ subject, body, subjectEn: null, bodyEn: null, edited: true, approved: false, approvedAt: null });
  await event(id, "edited", "draft edited by hand");
  revalidatePath("/review");
  return t("Edit save ho gaya\nEk baar aur padh lo, phir approve karo.", "Edit saved\nRead it once more, then approve.");
}
