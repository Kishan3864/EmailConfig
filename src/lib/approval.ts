import { C, db, nowIso } from "./fsdb";
import { textKey } from "./english";
import { event } from "./log";

/**
 * THE ONLY place in the app that approves a draft (sets approved = true). Nothing else ever does: not a new draft,
 * not the campaign start, not resume, not the DRY-RUN / LIVE switch, not a migration. It runs only from my own click
 * on the Approve page (one mail, the selected ones, or "Sab approve karo"). An approved draft is in the send queue:
 * the worker sends it by itself within the sending rules (lib/sender.ts).
 * `key` (textKey of the subject + body I was shown) makes sure I approve exactly the text I read: a draft that was
 * edited or remade since (another tab, "Naya version") is refused until I read it again.
 *   ok         -> approved now
 *   needs_text -> the draft still waits for my words ("Text chahiye"): it cannot be approved until I write them
 *   changed    -> the text is no longer the one I read
 *   gone       -> no longer an unapproved draft (sent, rejected, approved already, deleted), or its lead can no longer
 *                 be mailed (blocked, opted out, replied…)
 */
export async function approveDraft(id: string, key?: string | null): Promise<"ok" | "needs_text" | "changed" | "gone"> {
  const ref = C.messages.doc(id);
  const r = await db.runTransaction(async (tx) => {
    const m = await tx.get(ref);
    if (!m.exists) return "gone" as const;
    if (m.get("status") === "needs_text") return "needs_text" as const;
    if (m.get("status") !== "ready" || m.get("approved") === true) return "gone" as const;
    if (key && textKey(m.get("subject") || "", m.get("body") || "") !== key) return "changed" as const;
    const lead = await tx.get(C.leads.doc(m.get("leadId") || id));
    if (!lead.exists || lead.get("status") !== "ready") return "gone" as const;
    tx.update(ref, { approved: true, approvedAt: nowIso() });
    return "ok" as const;
  });
  if (r === "ok") await event(id, "approved_mail", "mail approved by me: in the send queue");
  return r;
}

/** approveDraft for several mails (selected, or all shown); every one is checked on its own. Items are "id" or "id::key". */
export async function approveDrafts(items: string[]) {
  const out = { ok: 0, needsText: 0, changed: 0, gone: 0, okIds: [] as string[] };
  for (const item of [...new Set(items)]) {
    const i = item.lastIndexOf("::");
    const [id, key] = i > 0 ? [item.slice(0, i), item.slice(i + 2)] : [item, null];
    const r = await approveDraft(id, key);
    if (r === "ok") { out.ok++; out.okIds.push(id); }
    else if (r === "needs_text") out.needsText++;
    else if (r === "changed") out.changed++;
    else out.gone++;
  }
  return out;
}

/** Unsent states a mail can be in: a lead that may no longer be mailed takes it out of them for good. */
const UNSENT = ["needs_text", "ready", "retry"];

/**
 * A lead that may no longer be mailed (blocked, opted out, replied, already contacted…): its unsent mail leaves the
 * queue for good ("blocked", unapproved), so it can neither be sent nor hold up the mails behind it.
 */
export async function withdrawDraft(leadId: string, why: string) {
  const ref = C.messages.doc(leadId);
  const done = await db.runTransaction(async (tx) => {
    const m = await tx.get(ref);
    if (!m.exists || !UNSENT.includes(m.get("status"))) return false;
    tx.update(ref, { status: "blocked", approved: false, error: why, enNeeded: false, enRetryAt: null });
    return true;
  });
  if (done) await event(leadId, "skipped", `mail taken out of the queue: ${why}`);
  return done;
}
