import { FieldValue } from "firebase-admin/firestore";
import { db, C, key, nowIso, rows, type Campaign, type LeadList, type Lead, type Message } from "./fsdb";
import { getSettings, getState, setState, addSendDay, type Settings } from "./settings";
import { buildRaw, sendRaw, appendToSent } from "./mailer";
import { footer } from "./lang";
import { inWindow, nextSendingDay, sentToday, todayCap } from "./schedule";
import { canSend, emergencyStop, checkBounceThresholds } from "./guard";
import { emailDomain, siteDomain } from "./importer";
import { partsIn } from "./time";
import { log, event } from "./log";

type SmtpErr = { code?: string; command?: string; responseCode?: number; response?: string; message?: string };

/**
 * pause     -> auth / policy / rate-limit: stop everything
 * hard      -> recipient rejected permanently: bounced + suppress
 * retry     -> server clearly did NOT accept (connection refused, 4xx)
 * uncertain -> we cannot know if it was accepted: check manually, never resend
 */
export function classify(e: SmtpErr): "pause" | "hard" | "retry" | "uncertain" {
  const text = `${e.response || ""} ${e.message || ""}`;
  const rc = e.responseCode;
  if (e.code === "EAUTH" || rc === 530 || rc === 534 || rc === 535 || rc === 454) return "pause";
  if (/rate|limit|too many|quota|throttl|policy|spam|block|blacklist|reputation|suspend|exceed|denied|abuse/i.test(text) && (rc || e.code === "EENVELOPE" || e.code === "EMESSAGE")) return "pause";
  if (rc && rc >= 500 && (/^RCPT/i.test(e.command || "") || /user unknown|no such|does not exist|mailbox unavailable|invalid recipient|recipient address rejected|unknown user|not found/i.test(text))) return "hard";
  if (rc && rc >= 400 && rc < 500) return "retry";
  if (["ECONNECTION", "EDNS", "ESOCKET", "ETIMEDOUT", "ECONNREFUSED"].includes(e.code || "") && /^(CONN|EHLO|HELO|AUTH|MAIL)/i.test(e.command || "CONN")) return "retry";
  if (rc && rc >= 500) return "pause"; // unexplained permanent rejection of my message: stop and look
  return "uncertain";
}

export function signature(s: Settings) {
  const lines = [s.senderName, [s.senderRole, s.business].filter(Boolean).join(", "), s.website, ...s.portfolio.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean)];
  return lines.filter(Boolean).join("\n");
}

export function fullText(s: Settings, body: string, lang: string, source: string) {
  return `${body.trim()}\n\n${signature(s)}\n\n${footer(lang, source, s.postalAddress)}`;
}

const setLead = (id: string, data: Record<string, unknown>) => C.leads.doc(id).update({ ...data, updatedAt: nowIso() });

/** Ledger entry status update (never deleted) */
const setLedger = (email: string, bizKey: string, status: string, extra: Record<string, unknown> = {}) =>
  Promise.all([
    C.contacted.doc(key(email)).set({ status, updatedAt: nowIso(), ...extra }, { merge: true }),
    C.contactedBiz.doc(key(bizKey)).set({ status, updatedAt: nowIso() }, { merge: true }),
  ]);

async function nextMessage(c: Campaign, dryRun: boolean, now: Date): Promise<Message | null> {
  if (dryRun) {
    const m = await C.messages.where("campaignId", "==", c.id).where("status", "==", "ready").where("dryRunDone", "==", false).orderBy("createdAt").limit(1).get();
    return rows<Message>(m)[0] || null;
  }
  const m = rows<Message>(await C.messages.where("campaignId", "==", c.id).where("status", "in", ["ready", "retry"]).orderBy("createdAt").limit(30).get());
  return m.find((x) => x.status === "ready" || (x.nextAttemptAt && new Date(x.nextAttemptAt) <= now)) || null;
}

/** Try to send exactly one mail. Called by the worker tick. */
export async function trySendOne(): Promise<string> {
  if (!(await canSend())) return "stopped";
  const s = await getSettings();
  const st = await getState();
  const now = new Date();
  if (st.nextSendAt && new Date(st.nextSendAt) > now) return "waiting gap";
  if (!s.fromEmail || !process.env.SMTP_PASSWORD) return "smtp not configured";

  const campaigns = rows<Campaign>(await C.campaigns.where("status", "==", "running").get()).filter((c) => c.samplesApproved).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const c of campaigns) {
    if (!inWindow(now, s, c.timezone)) continue;
    if ((await sentToday(c.timezone, now)) >= (await todayCap(s, c.timezone, now))) continue;

    const msg = await nextMessage(c, s.dryRun, now);
    if (!msg) continue;
    const leadSnap = await C.leads.doc(msg.leadId).get();
    const lead = { id: leadSnap.id, ...leadSnap.data() } as Lead;
    if (lead.status !== "ready") continue;
    const list = (await C.lists.doc(lead.listId).get()).data() as LeadList | undefined;
    const text = fullText(s, msg.body, msg.language, list?.sourceNote || "a public business directory");
    const gapMin = s.gapMinMin + Math.random() * Math.max(0, s.gapMaxMin - s.gapMinMin);

    // ---------- DRY RUN: everything runs, delivery only to my test address ----------
    if (s.dryRun) {
      if (!s.testEmail) return "dry-run needs a test address";
      const { raw } = await buildRaw({ s, to: s.testEmail, subject: `[DRY RUN → ${lead.email}] ${msg.subject}`, text, listUnsub: true });
      try {
        const info = await sendRaw(s, s.testEmail, raw);
        await C.sendLogs.add({ messageId: msg.id, leadId: lead.id, to: s.testEmail, dryRun: true, ok: true, response: String(info.response), at: nowIso() });
        await C.messages.doc(msg.id).update({ dryRunDone: true });
        await setLead(lead.id, { dryRunAt: nowIso() });
        await event(lead.id, "dry_run", `delivered to test address: ${info.response}`);
        await log("info", "send", `DRY RUN ${lead.email} -> ${s.testEmail}: ${info.response}`);
      } catch (e) {
        const err = e as SmtpErr;
        await C.sendLogs.add({ messageId: msg.id, leadId: lead.id, to: s.testEmail, dryRun: true, ok: false, response: `${err.code || ""} ${err.response || err.message}`, at: nowIso() });
        if (classify(err) === "pause") await emergencyStop(`SMTP error (dry run): ${err.response || err.message}`);
        else await log("warn", "send", `dry-run send failed: ${err.response || err.message}`);
      }
      await setState({ nextSendAt: new Date(Date.now() + gapMin * 60000).toISOString() });
      return "dry-run sent";
    }

    // ---------- LIVE: ledger check + claim in ONE transaction, BEFORE the SMTP call ----------
    const emailRef = C.contacted.doc(key(lead.email));
    const bizRef = C.contactedBiz.doc(key(lead.businessKey));
    const suppRefs = [...new Set([lead.email, emailDomain(lead.email), siteDomain(lead.website)].filter(Boolean))].map((v) => C.suppression.doc(key(v)));
    const msgRef = C.messages.doc(msg.id);
    const claim = await db.runTransaction(async (tx) => {
      const [m, l, ce, cb, ...supp] = await tx.getAll(msgRef, leadSnap.ref, emailRef, bizRef, ...suppRefs);
      if (!m.exists || m.get("status") !== msg.status || l.get("status") !== "ready") return "lost";
      if (supp.some((x) => x.exists)) { tx.update(l.ref, { status: "suppressed", updatedAt: nowIso() }); return "suppressed"; }
      // the ledger may only already hold this address if it was claimed by THIS message (a retry after a clear refusal)
      if ((ce.exists && ce.get("messageRef") !== msg.id) || (cb.exists && cb.get("messageRef") !== msg.id)) {
        tx.update(l.ref, { status: "already_contacted", updatedAt: nowIso() });
        tx.update(msgRef, { status: "blocked", error: "address or business already in the contacted ledger" });
        return "blocked";
      }
      const entry = { status: "sending", source: "outreach", leadId: lead.id, messageRef: msg.id, campaignId: c.id, at: ce.exists ? ce.get("at") : nowIso(), updatedAt: nowIso() };
      tx.set(emailRef, { email: lead.email, ...entry }, { merge: true });
      tx.set(bizRef, { businessKey: lead.businessKey, email: lead.email, ...entry }, { merge: true });
      tx.update(msgRef, { status: "sending", attempts: FieldValue.increment(1), sendStartedAt: nowIso() });
      return "ok";
    });
    if (claim !== "ok") {
      await event(lead.id, "skipped", `not sent: ${claim}`);
      if (claim !== "lost") await log("warn", "send", `${lead.email} not sent: ${claim}`);
      continue;
    }
    await event(lead.id, "sending", `attempt ${msg.attempts + 1}`);

    const { raw, messageId } = await buildRaw({ s, to: lead.email, subject: msg.subject, text, listUnsub: true });
    let info: Awaited<ReturnType<typeof sendRaw>> | null = null;
    let error: SmtpErr | null = null;
    try { info = await sendRaw(s, lead.email, raw); } catch (e) { error = e as SmtpErr; }

    if (info && info.accepted?.length && !info.rejected?.length) {
      const response = String(info.response);
      const b = db.batch();
      b.update(msgRef, { status: "sent", sentAt: nowIso(), smtpResponse: response, messageId });
      b.update(leadSnap.ref, { status: "sent", updatedAt: nowIso() });
      b.create(C.sendLogs.doc(), { messageId: msg.id, leadId: lead.id, to: lead.email, dryRun: false, ok: true, response, at: nowIso() });
      await b.commit();
      await setLedger(lead.email, lead.businessKey, "sent", { sentAt: nowIso() });
      await addSendDay(c.timezone, partsIn(now, c.timezone).dayKey);
      await event(lead.id, "sent", response);
      await log("info", "send", `sent to ${lead.email}: ${response}`);
      await setState({ nextSendAt: new Date(Date.now() + gapMin * 60000).toISOString() });
      await appendToSent(s, raw).catch((e) => log("warn", "imap", `append to Sent failed: ${e instanceof Error ? e.message : e}`));
      return "sent";
    }

    if (info && info.rejected?.length) error = { responseCode: 550, command: "RCPT TO", response: String(info.response || "recipient rejected") };
    const err = error || { message: "unknown result" };
    const kind = classify(err);
    const response = `${err.code || ""} ${err.command || ""} ${err.responseCode || ""} ${err.response || err.message || ""}`.trim();
    await C.sendLogs.add({ messageId: msg.id, leadId: lead.id, to: lead.email, dryRun: false, ok: false, hardBounce: kind === "hard", response, at: nowIso() });
    await event(lead.id, "smtp_error", `${kind}: ${response}`);
    await log(kind === "retry" ? "warn" : "error", "send", `${lead.email} ${kind}: ${response}`);

    if (kind === "uncertain") {
      await msgRef.update({ status: "check_manual", error: response });
      await setLead(lead.id, { status: "check_manual" });
      await setLedger(lead.email, lead.businessKey, "uncertain");
    } else if (kind === "hard") {
      await msgRef.update({ status: "bounced", error: response });
      await setLead(lead.id, { status: "bounced" });
      await setLedger(lead.email, lead.businessKey, "bounced");
      await C.suppression.doc(key(lead.email)).set({ value: lead.email, kind: "email", reason: "hard bounce (SMTP)", createdAt: nowIso() }, { merge: true });
      await checkBounceThresholds(c.timezone);
    } else {
      // pause or retry: the server clearly did not accept the message
      const failed = msg.attempts + 1 >= 3;
      await msgRef.update({ status: failed ? "failed" : "retry", error: response, nextAttemptAt: nextSendingDay(now, s, c.timezone).toISOString() });
      if (failed) { await setLead(lead.id, { status: "failed" }); await setLedger(lead.email, lead.businessKey, "failed"); }
      else await setLedger(lead.email, lead.businessKey, "refused_will_retry");
      if (kind === "pause") await emergencyStop(`SMTP auth/policy/rate-limit error: ${response}`);
      else {
        const recentFails = (await C.sendLogs.orderBy("at", "desc").limit(3).get()).docs.filter((d) => !d.get("ok") && !d.get("dryRun")).length;
        if (recentFails >= 3) await emergencyStop(`3 consecutive SMTP failures: ${response}`);
      }
    }
    await setState({ nextSendAt: new Date(Date.now() + (kind === "retry" ? 30 : gapMin) * 60000).toISOString() });
    return kind;
  }
  return "nothing to send";
}

/** Anything left in "sending" for >10 min may or may not have gone out: check manually, never resend. */
export async function recoverCrashed() {
  const cutoff = new Date(Date.now() - 10 * 60000).toISOString();
  const stuck = rows<Message>(await C.messages.where("status", "==", "sending").get()).filter((m) => (m.sendStartedAt || "") < cutoff);
  for (const m of stuck) {
    await C.messages.doc(m.id).update({ status: "check_manual", error: "worker stopped mid-send" });
    await setLead(m.leadId, { status: "check_manual" });
    const l = (await C.leads.doc(m.leadId).get()).data() as Lead;
    await setLedger(l.email, l.businessKey, "uncertain");
    await event(m.leadId, "check_manual", "worker stopped mid-send; never resent automatically");
    await log("warn", "send", `message for ${m.leadEmail} marked check-manual after crash`);
  }
}

/** Mark campaigns done when nothing is left to send. */
export async function closeFinishedCampaigns() {
  const running = rows<Campaign>(await C.campaigns.where("status", "==", "running").get());
  for (const c of running) {
    const left = await C.leads.where("campaignId", "==", c.id).where("status", "==", "ready").limit(1).get();
    if (left.empty) { await C.campaigns.doc(c.id).update({ status: "done" }); await log("info", "campaign", `campaign "${c.name}" finished`); }
  }
}
