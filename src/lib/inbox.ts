import { simpleParser, type ParsedMail } from "mailparser";
import { prisma } from "./db";
import { getSettings, getState, setState } from "./settings";
import { imapClient, notify } from "./mailer";
import { checkBounceThresholds } from "./guard";
import { detectLang } from "./lang";
import { translateToEnglish } from "./ai";
import { FREEMAIL, emailDomain } from "./importer";
import { log, event } from "./log";

const OPTOUT = /\b(stop|unsubscribe|remove me|remove|d[ée]sinscri\w*|d[ée]sabonn\w*|retirez|supprimez|abmelden|baja)\b/i;
const AUTO_SUBJ = /(out of office|automatic reply|auto.?reply|autoreply|absence|absent|réponse automatique|abwesenheit|fuera de la oficina|congés|vacances|vacation|away from)/i;

function freshText(text: string) {
  const out: string[] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (/^\s*>/.test(line)) break;
    if (/^(on .+wrote:|le .+a écrit\s*:|am .+schrieb|el .+escribió|-----original message|de\s*:|from\s*:)/i.test(line.trim())) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

async function findLead(addr: string) {
  const byEmail = await prisma.lead.findUnique({ where: { email: addr } });
  if (byEmail) return byEmail;
  const d = emailDomain(addr);
  if (!d || FREEMAIL.has(d)) return null;
  return prisma.lead.findUnique({ where: { businessKey: d } });
}

async function suppress(value: string, reason: string) {
  await prisma.suppression.upsert({ where: { value }, create: { value, kind: value.includes("@") ? "email" : "domain", reason }, update: {} });
}

async function handle(p: ParsedMail) {
  const s = await getSettings();
  const from = (p.from?.value?.[0]?.address || "").toLowerCase();
  const messageId = p.messageId || `${from}-${p.date?.toISOString()}`;
  if (await prisma.reply.findUnique({ where: { messageId } })) return;
  if (from === s.fromEmail.toLowerCase()) return;
  const subject = p.subject || "";
  const text = p.text || "";
  const receivedAt = p.date || new Date();
  const ctype = String(p.headers.get("content-type") && (p.headers.get("content-type") as { value?: string }).value || "");

  // ---------- bounces ----------
  const attachText = (p.attachments || []).filter((a) => /delivery-status|rfc822-headers|text/i.test(a.contentType)).map((a) => a.content.toString("utf8")).join("\n");
  if (/mailer-daemon|postmaster|mail delivery|maildelivery/i.test(from + " " + (p.from?.text || "")) || /report/i.test(ctype) || /delivery status notification|undeliver|returned mail|non remis|échec de la remise/i.test(subject)) {
    const all = `${text}\n${attachText}`;
    const recips = new Set<string>();
    for (const m of all.matchAll(/(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s>]+)>?/gi)) recips.add(m[1].toLowerCase());
    if (!recips.size) {
      for (const m of all.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
        const e = m[0].toLowerCase();
        if (await prisma.lead.findFirst({ where: { email: e, status: { in: ["sent", "check_manual"] } } })) recips.add(e);
      }
    }
    const status = all.match(/Status:\s*([245])\.\d{1,3}\.\d{1,3}/i)?.[1];
    const hard = status ? status === "5" : /permanent|550|5\.\d\.\d|user unknown|does not exist|no such user|address rejected/i.test(all);
    for (const e of recips) {
      const lead = await prisma.lead.findUnique({ where: { email: e } });
      if (!lead) continue;
      await prisma.reply.create({ data: { leadId: lead.id, kind: hard ? "bounce" : "softbounce", fromEmail: from, subject, body: all.slice(0, 5000), messageId: `${messageId}#${e}`, receivedAt } });
      if (hard) {
        await prisma.lead.update({ where: { id: lead.id }, data: { status: "bounced" } });
        await prisma.message.updateMany({ where: { leadId: lead.id }, data: { status: "bounced" } });
        await suppress(e, "hard bounce");
        await event(lead.id, "bounced", subject);
        await log("warn", "inbox", `hard bounce: ${e}`);
      } else await log("info", "inbox", `soft bounce (ignored): ${e}`);
    }
    if (hard && recips.size) await checkBounceThresholds();
    return;
  }

  const lead = await findLead(from);
  if (!lead) return; // not one of my leads

  // ---------- auto-replies ----------
  const h = (k: string) => String((p.headers.get(k) as string) || "").toLowerCase();
  const auto = (h("auto-submitted") && h("auto-submitted") !== "no") || p.headers.has("x-autoreply") || p.headers.has("x-autorespond") || /auto_reply|bulk|junk/.test(h("precedence")) || AUTO_SUBJ.test(subject);
  if (auto) {
    await prisma.reply.create({ data: { leadId: lead.id, kind: "auto", fromEmail: from, subject, body: text.slice(0, 5000), messageId, receivedAt } });
    await event(lead.id, "auto_reply", subject);
    return;
  }

  const fresh = freshText(text) || text.slice(0, 1000);
  let bodyEn: string | null = null;
  if (detectLang(fresh) !== "en") bodyEn = await translateToEnglish(fresh).catch(() => null);

  // ---------- opt-outs ----------
  if (OPTOUT.test(fresh.slice(0, 600)) || OPTOUT.test(subject)) {
    await prisma.reply.create({ data: { leadId: lead.id, kind: "optout", fromEmail: from, subject, body: fresh.slice(0, 5000), bodyEn, messageId, receivedAt } });
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "opted_out" } });
    await suppress(from, "opt-out reply");
    if (from !== lead.email) await suppress(lead.email, "opt-out reply");
    await event(lead.id, "opted_out", fresh.slice(0, 200));
    await log("info", "inbox", `opt-out: ${from}`);
    return;
  }

  // ---------- real replies ----------
  await prisma.reply.create({ data: { leadId: lead.id, kind: "reply", fromEmail: from, subject, body: fresh.slice(0, 20000), bodyEn, messageId, receivedAt } });
  if (!["bounced", "opted_out"].includes(lead.status)) await prisma.lead.update({ where: { id: lead.id }, data: { status: "replied" } });
  await event(lead.id, "replied", subject);
  await log("info", "inbox", `reply from ${from}`);
  await notify(`Reply from ${lead.businessName || from}`, `${from} replied:\n\n${fresh.slice(0, 1500)}${bodyEn ? `\n\n--- English ---\n${bodyEn}` : ""}`);
}

export async function syncInbox() {
  const s = await getSettings();
  if (!s.fromEmail || !(process.env.IMAP_PASSWORD || process.env.SMTP_PASSWORD)) return "imap not configured";
  const st = await getState();
  const c = imapClient(s);
  await c.connect();
  let count = 0;
  try {
    const lock = await c.getMailboxLock("INBOX");
    try {
      const mb = c.mailbox as { uidValidity: bigint; uidNext: number };
      let last = st.imapLastUid;
      if (st.imapUidValidity !== String(mb.uidValidity)) last = 0;
      let range: string | { since: Date } = `${last + 1}:*`;
      if (last === 0) range = { since: new Date(Date.now() - 14 * 86400000) };
      const uids = (await c.search(typeof range === "string" ? { uid: range } : range, { uid: true })) || [];
      let maxUid = last;
      for (const uid of uids) {
        if (uid <= last) continue;
        const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
        if (msg && msg.source) {
          try { await handle(await simpleParser(msg.source)); count++; }
          catch (e) { await log("error", "inbox", `failed to process uid ${uid}: ${e instanceof Error ? e.message : e}`); }
        }
        maxUid = Math.max(maxUid, uid);
      }
      await setState({ imapUidValidity: String(mb.uidValidity), imapLastUid: Math.max(maxUid, last === 0 ? mb.uidNext - 1 : maxUid), lastSyncAt: new Date().toISOString() });
    } finally { lock.release(); }
  } finally { await c.logout().catch(() => {}); }
  return `processed ${count}`;
}
