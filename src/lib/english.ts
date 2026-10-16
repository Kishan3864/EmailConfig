/*
 * The English version of every mail, only for me to check what the lead will read (lib/translate.ts makes it).
 * A stored translation counts only for the exact text it was made from: textKey() fingerprints subject + body,
 * so after an edit the old translation is never shown as if it matched the new text.
 * Pure code (no server imports).
 */

/** FNV-1a, twice with different seeds: a 16-hex-char fingerprint (not for security, only to notice a changed text). */
function fnv(s: string, seed: number) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function textKey(subject: string, body: string) {
  const s = `${subject}\n\u0000\n${body}`;
  return fnv(s, 0x811c9dc5) + fnv(s, 0x9747b28c);
}

type MailText = {
  language: string; subject: string; body: string; status?: string;
  subjectEn?: string | null; bodyEn?: string | null; enFor?: string | null; enError?: string | null;
  enNeeded?: boolean; enRetryAt?: string | null;
};

export type EnglishState =
  | { kind: "same" } // the mail is written in English: the left side already is the meaning
  | { kind: "ready"; subject: string; body: string }
  // not made yet, failed, or the text changed since. queued: the worker will (re)try by itself, in retryIn minutes
  // (0 = on its next rounds); rejected: a rejected mail is never sent, so it never gets one
  | { kind: "pending"; stale: boolean; error?: string; queued: boolean; retryIn?: number; rejected?: boolean };

export function englishOf(m: MailText): EnglishState {
  if (m.language === "en") return { kind: "same" };
  // drafts from before the fingerprint have no enFor: their translation was made together with the text
  if (m.bodyEn && (!m.enFor || m.enFor === textKey(m.subject, m.body))) return { kind: "ready", subject: m.subjectEn || "", body: m.bodyEn };
  const rejected = m.status === "rejected";
  // drafts from before translations existed have no enNeeded yet: the worker flags every unsent one when it starts
  const queued = !rejected && (!!m.enRetryAt || (m.enNeeded === undefined && m.status === "ready"));
  const retryIn = m.enRetryAt ? Math.max(0, Math.ceil((Date.parse(m.enRetryAt) - Date.now()) / 60000)) : undefined;
  return { kind: "pending", stale: !!m.bodyEn, error: m.enError || undefined, queued, retryIn, rejected };
}
