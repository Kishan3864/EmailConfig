import { prisma } from "./db";
import { getSettings, getState, setState, type Settings } from "./settings";
import { buildRaw, sendRaw, appendToSent } from "./mailer";
import { footer } from "./lang";
import { inWindow, nextSendingDay, sentToday, todayCap } from "./schedule";
import { canSend, emergencyStop, checkBounceThresholds } from "./guard";
import { emailDomain, siteDomain } from "./importer";
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

let connFailures = 0;

async function isSuppressed(email: string, website?: string | null) {
  const vals = [email, emailDomain(email), siteDomain(website)].filter(Boolean);
  return (await prisma.suppression.count({ where: { value: { in: vals } } })) > 0;
}

/** Try to send exactly one mail. Called by the worker every tick. */
export async function trySendOne(): Promise<string> {
  if (!(await canSend())) return "stopped";
  const s = await getSettings();
  const st = await getState();
  const now = new Date();
  if (st.nextSendAt && new Date(st.nextSendAt) > now) return "waiting gap";
  if (!s.fromEmail || !process.env.SMTP_PASSWORD) return "smtp not configured";

  const campaigns = await prisma.campaign.findMany({ where: { status: "running", samplesApproved: true }, include: { list: true }, orderBy: { id: "asc" } });
  for (const c of campaigns) {
    if (!inWindow(now, s, c.timezone)) continue;
    if ((await sentToday(c.timezone, now)) >= (await todayCap(s, c.timezone, now))) continue;

    const msg = await prisma.message.findFirst({
      where: s.dryRun
        ? { campaignId: c.id, status: "ready", lead: { status: "ready", dryRunAt: null } }
        : { campaignId: c.id, lead: { status: "ready" }, OR: [{ status: "ready" }, { status: "retry", nextAttemptAt: { lte: now } }] },
      include: { lead: true }, orderBy: { id: "asc" },
    });
    if (!msg) continue;
    const lead = msg.lead;

    if (await isSuppressed(lead.email, lead.website)) {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: "suppressed" } });
      await event(lead.id, "skipped", "suppressed before send");
      continue;
    }

    const text = fullText(s, msg.body, msg.language, c.list.sourceNote || "a public business directory");
    const gapMin = s.gapMinMin + Math.random() * Math.max(0, s.gapMaxMin - s.gapMinMin);

    // ---------- DRY RUN: everything runs, delivery only to my test address ----------
    if (s.dryRun) {
      if (!s.testEmail) return "dry-run needs a test address";
      const { raw } = await buildRaw({ s, to: s.testEmail, subject: `[DRY RUN → ${lead.email}] ${msg.subject}`, text, listUnsub: true });
      try {
        const info = await sendRaw(s, s.testEmail, raw);
        await prisma.sendLog.create({ data: { messageId: msg.id, leadId: lead.id, to: s.testEmail, dryRun: true, ok: true, response: String(info.response) } });
        await prisma.lead.update({ where: { id: lead.id }, data: { dryRunAt: new Date() } });
        await event(lead.id, "dry_run", `delivered to test address: ${info.response}`);
        await log("info", "send", `DRY RUN ${lead.email} -> ${s.testEmail}: ${info.response}`);
      } catch (e) {
        const err = e as SmtpErr;
        await prisma.sendLog.create({ data: { messageId: msg.id, leadId: lead.id, to: s.testEmail, dryRun: true, ok: false, response: `${err.code || ""} ${err.response || err.message}` } });
        if (classify(err) === "pause") await emergencyStop(`SMTP error (dry run): ${err.response || err.message}`);
        else await log("warn", "send", `dry-run send failed: ${err.response || err.message}`);
      }
      await setState({ nextSendAt: new Date(Date.now() + gapMin * 60000).toISOString() });
      return "dry-run sent";
    }

    // ---------- LIVE: claim the message in a transaction BEFORE the SMTP call ----------
    const claimed = await prisma.$transaction(async (tx) => {
      const r = await tx.message.updateMany({
        where: { id: msg.id, status: msg.status },
        data: { status: "sending", attempts: { increment: 1 }, sendStartedAt: new Date() },
      });
      if (r.count === 1) await tx.event.create({ data: { leadId: lead.id, type: "sending", detail: `attempt ${msg.attempts + 1}` } });
      return r.count === 1;
    });
    if (!claimed) return "lost claim";

    const { raw, messageId } = await buildRaw({ s, to: lead.email, subject: msg.subject, text, listUnsub: true });
    let info: Awaited<ReturnType<typeof sendRaw>> | null = null;
    let error: SmtpErr | null = null;
    try { info = await sendRaw(s, lead.email, raw); } catch (e) { error = e as SmtpErr; }

    if (info && info.accepted?.length && !info.rejected?.length) {
      connFailures = 0;
      const response = String(info.response);
      await prisma.$transaction([
        prisma.message.update({ where: { id: msg.id }, data: { status: "sent", sentAt: new Date(), smtpResponse: response, messageId } }),
        prisma.lead.update({ where: { id: lead.id }, data: { status: "sent" } }),
        prisma.sendLog.create({ data: { messageId: msg.id, leadId: lead.id, to: lead.email, ok: true, response } }),
        prisma.event.create({ data: { leadId: lead.id, type: "sent", detail: response } }),
      ]);
      await log("info", "send", `sent to ${lead.email}: ${response}`);
      await setState({ nextSendAt: new Date(Date.now() + gapMin * 60000).toISOString() });
      appendToSent(s, raw).catch((e) => log("warn", "imap", `append to Sent failed: ${e instanceof Error ? e.message : e}`));
      return "sent";
    }

    if (info && info.rejected?.length) error = { responseCode: 550, command: "RCPT TO", response: String(info.response || "recipient rejected") };
    const err = error || { message: "unknown result" };
    const kind = classify(err);
    const response = `${err.code || ""} ${err.command || ""} ${err.responseCode || ""} ${err.response || err.message || ""}`.trim();
    await prisma.sendLog.create({ data: { messageId: msg.id, leadId: lead.id, to: lead.email, ok: false, response } });
    await event(lead.id, "smtp_error", `${kind}: ${response}`);
    await log(kind === "retry" ? "warn" : "error", "send", `${lead.email} ${kind}: ${response}`);

    if (kind === "uncertain") {
      await prisma.message.update({ where: { id: msg.id }, data: { status: "check_manual", error: response } });
      await prisma.lead.update({ where: { id: lead.id }, data: { status: "check_manual" } });
    } else if (kind === "hard") {
      await prisma.message.update({ where: { id: msg.id }, data: { status: "bounced", error: response } });
      await prisma.lead.update({ where: { id: lead.id }, data: { status: "bounced" } });
      await prisma.suppression.upsert({ where: { value: lead.email }, create: { value: lead.email, kind: "email", reason: "hard bounce (SMTP)" }, update: {} });
      await checkBounceThresholds(c.timezone);
    } else {
      // pause or retry: the server clearly did not accept the message
      const failed = msg.attempts + 1 >= 3;
      await prisma.message.update({
        where: { id: msg.id },
        data: { status: failed ? "failed" : "retry", error: response, nextAttemptAt: nextSendingDay(now, s, c.timezone) },
      });
      if (failed) await prisma.lead.update({ where: { id: lead.id }, data: { status: "failed" } });
      if (kind === "pause") await emergencyStop(`SMTP auth/policy/rate-limit error: ${response}`);
      else if (++connFailures >= 3) await emergencyStop(`3 consecutive SMTP failures: ${response}`);
    }
    await setState({ nextSendAt: new Date(Date.now() + (kind === "retry" ? 30 : gapMin) * 60000).toISOString() });
    return kind;
  }
  return "nothing to send";
}

/** On worker start: anything left in "sending" may or may not have gone out. */
export async function recoverCrashed() {
  const stuck = await prisma.message.findMany({ where: { status: "sending" } });
  for (const m of stuck) {
    await prisma.message.update({ where: { id: m.id }, data: { status: "check_manual", error: "worker stopped mid-send" } });
    await prisma.lead.update({ where: { id: m.leadId }, data: { status: "check_manual" } });
    await event(m.leadId, "check_manual", "worker stopped mid-send; never resent automatically");
    await log("warn", "send", `message ${m.id} marked check-manual after crash`);
  }
}

/** Mark campaigns done when nothing is left to send. */
export async function closeFinishedCampaigns() {
  const running = await prisma.campaign.findMany({ where: { status: "running" } });
  for (const c of running) {
    const left = await prisma.lead.count({ where: { campaignId: c.id, status: "ready" } });
    if (left === 0) { await prisma.campaign.update({ where: { id: c.id }, data: { status: "done" } }); await log("info", "campaign", `campaign "${c.name}" finished`); }
  }
}
