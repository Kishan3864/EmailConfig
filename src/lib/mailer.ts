import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { ImapFlow } from "imapflow";
import { getSettings, type Settings } from "./settings";

export function smtpTransport(s: Settings) {
  return nodemailer.createTransport({
    host: s.smtpHost, port: s.smtpPort, secure: s.smtpSecure,
    auth: { user: s.smtpUser || s.fromEmail, pass: process.env.SMTP_PASSWORD || "" },
    connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 60000,
    logger: false, debug: false,
  });
}

export function imapClient(s: Settings) {
  return new ImapFlow({
    host: s.imapHost, port: s.imapPort, secure: s.imapSecure,
    auth: { user: s.imapUser || s.smtpUser || s.fromEmail, pass: process.env.IMAP_PASSWORD || process.env.SMTP_PASSWORD || "" },
    logger: false, socketTimeout: 60000,
  });
}

export function fromHeader(s: Settings) {
  return s.senderName ? { name: s.senderName, address: s.fromEmail } : s.fromEmail;
}

export async function buildRaw(opts: { s: Settings; to: string; subject: string; text: string; listUnsub?: boolean; extraHeaders?: Record<string, string> }) {
  const { s } = opts;
  const domain = s.fromEmail.split("@")[1] || "localhost";
  const messageId = `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}@${domain}>`;
  const headers: Record<string, string> = { ...(opts.extraHeaders || {}) };
  if (opts.listUnsub) headers["List-Unsubscribe"] = `<mailto:${s.fromEmail}?subject=STOP>`;
  const mail = new MailComposer({
    from: fromHeader(s), to: opts.to, subject: opts.subject, text: opts.text,
    messageId, headers, date: new Date(),
    textEncoding: "quoted-printable",
  });
  const raw: Buffer = await new Promise((res, rej) => mail.compile().build((err, msg) => (err ? rej(err) : res(msg))));
  return { raw, messageId };
}

/** Send a raw message. Returns the info object from nodemailer (throws on failure). */
export async function sendRaw(s: Settings, to: string, raw: Buffer) {
  const t = smtpTransport(s);
  try {
    return await t.sendMail({ envelope: { from: s.fromEmail, to: [to] }, raw });
  } finally { t.close(); }
}

export async function appendToSent(s: Settings, raw: Buffer) {
  const c = imapClient(s);
  await c.connect();
  try {
    const boxes = await c.list();
    const sent = boxes.find((b) => b.specialUse === "\\Sent") || boxes.find((b) => /^(inbox\.)?sent/i.test(b.path));
    await c.append(sent?.path || "INBOX.Sent", raw, ["\\Seen"]);
  } finally { await c.logout().catch(() => {}); }
}

/** Notifications to myself (not counted as outreach) */
export async function notify(subject: string, text: string) {
  const s = await getSettings();
  const to = s.alertEmail || s.testEmail;
  if (!to || !s.fromEmail) return;
  try {
    const { raw } = await buildRaw({ s, to, subject: `[Outreach] ${subject}`, text });
    await sendRaw(s, to, raw);
  } catch (e) { console.error("notify failed:", e instanceof Error ? e.message : e); }
}

export async function testSmtp() {
  const s = await getSettings();
  const t = smtpTransport(s);
  try { await t.verify(); return "SMTP OK: login accepted"; }
  finally { t.close(); }
}

export async function testImap() {
  const s = await getSettings();
  const c = imapClient(s);
  await c.connect();
  try {
    const boxes = await c.list();
    return `IMAP OK: ${boxes.length} folders (${boxes.slice(0, 6).map((b) => b.path).join(", ")})`;
  } finally { await c.logout().catch(() => {}); }
}

export async function sendTestMail() {
  const s = await getSettings();
  if (!s.testEmail) throw new Error("Set your test address first");
  const { raw } = await buildRaw({ s, to: s.testEmail, subject: "Test mail from your outreach app", text: "If you can read this, SMTP sending works.\n\n-- \nOutreach app" });
  const info = await sendRaw(s, s.testEmail, raw);
  return `Sent to ${s.testEmail}: ${info.response}`;
}
