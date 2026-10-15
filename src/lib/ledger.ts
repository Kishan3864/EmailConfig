import type { DocumentReference, DocumentSnapshot } from "firebase-admin/firestore";
import { db, C, key, nowIso } from "./fsdb";
import { getSettings } from "./settings";
import { imapClient } from "./mailer";
import { log } from "./log";

/*
 * ONCE-EVER RULE
 * Every address (and every business) that outreach has ever tried to email is written to
 * the permanent Firestore collections `contacted` / `contactedBiz` BEFORE the SMTP call,
 * inside a transaction. Nothing in the app ever deletes from them. Before any send the
 * same transaction re-checks the ledger, so an address can never get a second cold mail,
 * even from a different list, campaign, re-import or a crashed/duplicated worker.
 * Addresses you emailed yourself can be added by hand or imported from the Sent folder.
 */

export async function getAllChunked(refs: DocumentReference[]): Promise<DocumentSnapshot[]> {
  const out: DocumentSnapshot[] = [];
  for (let i = 0; i < refs.length; i += 300) if (refs.slice(i, i + 300).length) out.push(...(await db.getAll(...refs.slice(i, i + 300))));
  return out;
}

/** Add addresses to the ledger by hand (people you already emailed yourself). Existing entries are kept as they are. */
export async function addToLedger(emails: string[], source: string, note?: string) {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)))];
  const snaps = await getAllChunked(list.map((e) => C.contacted.doc(key(e))));
  const fresh = list.filter((_, i) => !snaps[i].exists);
  for (let i = 0; i < fresh.length; i += 400) {
    const b = db.batch();
    for (const e of fresh.slice(i, i + 400)) b.create(C.contacted.doc(key(e)), { email: e, status: "contacted_elsewhere", source, note: note || null, at: nowIso() });
    await b.commit();
  }
  // leads that were waiting to be emailed are now blocked
  for (const e of fresh) {
    const l = await C.leads.doc(key(e)).get();
    if (l.exists && ["ready", "needs_review"].includes(l.get("status"))) await l.ref.update({ status: "already_contacted", updatedAt: nowIso() });
  }
  return { added: fresh.length, alreadyThere: list.length - fresh.length };
}

/** Read every recipient from the mailbox's Sent folder and add them to the ledger. */
export async function importSentFolder() {
  const s = await getSettings();
  const c = imapClient(s);
  await c.connect();
  const found = new Set<string>();
  try {
    const boxes = await c.list();
    const sent = boxes.find((b) => b.specialUse === "\\Sent") || boxes.find((b) => /^(inbox\.)?sent/i.test(b.path));
    if (!sent) throw new Error("Sent folder not found");
    const lock = await c.getMailboxLock(sent.path);
    try {
      for await (const m of c.fetch("1:*", { envelope: true })) {
        for (const a of [...(m.envelope?.to || []), ...(m.envelope?.cc || []), ...(m.envelope?.bcc || [])]) if (a.address) found.add(a.address.toLowerCase());
      }
    } finally { lock.release(); }
  } finally { await c.logout().catch(() => {}); }
  found.delete(s.fromEmail.toLowerCase());
  if (s.testEmail) found.delete(s.testEmail.toLowerCase());
  if (s.alertEmail) found.delete(s.alertEmail.toLowerCase());
  const r = await addToLedger([...found], "sent-folder", "found in mailbox Sent folder");
  await log("info", "ledger", `Sent folder import: ${found.size} recipients, ${r.added} new in ledger`);
  return `Sent folder: ${found.size} recipients found, ${r.added} added to the contacted ledger (${r.alreadyThere} were already there)`;
}
