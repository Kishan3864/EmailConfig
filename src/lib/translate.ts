import type { DocumentSnapshot } from "firebase-admin/firestore";
import { C, db, nowIso, type Message } from "./fsdb";
import { chat, parseJson } from "./ai";
import { LANGS, detectLang } from "./lang";
import { getState, setState, type State } from "./settings";
import { englishOf, textKey } from "./english";
import { log } from "./log";

/*
 * Every mail that is not in English gets its own English translation, made from its final text (AI draft, template
 * draft or my edit alike), so the Approve page can show what the lead will really read. It is never sent.
 * A draft is translated right after it is made or edited; if that fails (AI down, rate limit), the worker tries
 * again later (ensureTranslations), less and less often.
 */

const PER_TICK = 3; // at most this many translations per worker cycle (free API limits)

/** A faithful English translation of one mail: what it says, not a nicer version of it. */
export async function translateMail(subject: string, body: string, lang: string) {
  const from = LANGS[lang] || "the original language";
  const system = `You translate cold emails from ${from} into English, so the sender can check exactly what the recipient will read.
RULES:
- Translate faithfully and completely, sentence by sentence. Do not summarize, shorten, improve, soften, correct or add anything.
- Keep the meaning, the tone and the level of politeness. Keep the same paragraphs and line breaks.
- Keep names of people, businesses, streets, places, brands and websites, and all numbers, exactly as written. Do not translate business names.
- Translate idioms by their real meaning.
Return JSON only: {"subject": "English subject", "body": "English body"}`;
  const out = parseJson(await chat([{ role: "system", content: system }, { role: "user", content: JSON.stringify({ subject, body }) }], undefined, true, 0.1));
  const subjectEn = String(out.subject || "").trim();
  const bodyEn = String(out.body || "").replace(/\r/g, "").trim();
  if (!bodyEn) throw new Error("the AI returned an empty translation");
  if (detectLang(bodyEn) !== "en") throw new Error("the AI's answer was not in English");
  return { subjectEn, bodyEn };
}

/** Minutes until the worker tries a failed translation again: try 1 failed -> 2 min, then 15, 30 … 6 h; after the last, only the button. */
const RETRY_MIN = [2, 15, 30, 60, 120, 240, 360, 360];
/** Failures that hit every call (rate limit, bad key, no credit, model gone): pause the AI for a while instead of retrying each mail. */
export const AI_DOWN = /HTTP (401|402|403|404|429)|rate.?limit|AI_API_KEY missing/i;
const PAUSE_MIN = 30;

// the pause is stored in state (aiBackoffUntil) for every process, and kept here too, so the rest of the same worker
// tick sees it at once (the tick read its state before the pause started)
let pausedUntil = 0;
export const aiPaused = () => Date.now() < pausedUntil;
export async function pauseAi() {
  pausedUntil = Date.now() + PAUSE_MIN * 60000;
  await setState({ aiBackoffUntil: new Date(pausedUntil).toISOString() });
}

/**
 * Makes the English translation of one message (force: also when it already has a current one).
 * Never throws: a failure is stored on the message (enError, enTries) with the time of the next try (enRetryAt).
 */
export async function ensureTranslation(id: string, force = false): Promise<{ ok: boolean; error?: string }> {
  const d = await C.messages.doc(id).get();
  if (!d.exists) return { ok: false, error: "message not found" };
  return translateSnap(d, force);
}

const DONE = { enNeeded: false, enRetryAt: null, enTries: 0 };

async function translateSnap(d: DocumentSnapshot, force: boolean): Promise<{ ok: boolean; error?: string }> {
  const ref = d.ref;
  const m = d.data() as Message;
  // a draft still waiting for my text is translated once I have written and saved it (saveDraftEdit queues it)
  if (m.status === "needs_text") {
    if (m.enNeeded || m.enRetryAt) await ref.update(DONE);
    return { ok: false, error: "the draft still needs your text" };
  }
  if (m.language === "en" || (!force && englishOf(m).kind === "ready")) {
    if (m.enNeeded || m.enRetryAt) await ref.update(DONE);
    return { ok: true };
  }
  const key = textKey(m.subject, m.body);
  try {
    const tr = await translateMail(m.subject, m.body, m.language);
    // the text may have been edited while the AI was translating: store only a translation of the current text
    const saved = await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (!cur.exists || textKey(cur.get("subject") || "", cur.get("body") || "") !== key) return false;
      tx.update(ref, { subjectEn: tr.subjectEn, bodyEn: tr.bodyEn, enFor: key, enError: null, enAt: nowIso(), ...DONE });
      return true;
    });
    return saved ? { ok: true } : { ok: false, error: "the text changed while it was being translated" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // an AI-wide failure is not this mail's fault: it does not use up one of its tries, it waits for the end of the pause
    const down = AI_DOWN.test(msg);
    const tries = (m.enTries || 0) + (down ? 0 : 1);
    const wait = down ? PAUSE_MIN : RETRY_MIN[tries - 1];
    await ref.update({
      enNeeded: true, enError: msg.slice(0, 300), enAt: nowIso(), enTries: tries,
      enRetryAt: wait ? new Date(Date.now() + wait * 60000).toISOString() : null,
    }).catch(() => {});
    if (down) await pauseAi();
    await log("warn", "ai", `translation failed for ${m.leadEmail || d.id} (try ${tries}): ${msg.slice(0, 300)}`);
    return { ok: false, error: msg };
  }
}

// once per worker start: unsent drafts made before translations existed (or edited by the old code) are queued
let flaggedOld = false;
async function flagOldDrafts() {
  if (flaggedOld) return;
  const docs = (await C.messages.where("status", "==", "ready").get()).docs;
  for (const d of docs) {
    const m = d.data() as Message;
    if (m.language !== "en" && m.enNeeded === undefined && englishOf(m).kind === "pending") await d.ref.update({ enNeeded: true, enRetryAt: nowIso(), enTries: 0 });
  }
  flaggedOld = true;
}

/** Worker: translate a few mails whose (next) try is due. Reads only those few documents. */
export async function ensureTranslations(st?: State) {
  st = st || (await getState());
  if (aiPaused() || (st.aiBackoffUntil && new Date(st.aiBackoffUntil) > new Date())) return;
  await flagOldDrafts();
  // enRetryAt is set on every new or edited mail that is not in English, and after a failed try; cleared once done
  const docs = (await C.messages.where("enRetryAt", "<=", nowIso()).orderBy("enRetryAt").limit(PER_TICK).get()).docs;
  for (const d of docs) {
    // a rejected mail is never sent: no need to translate it
    if (d.get("status") === "rejected") { await d.ref.update(DONE); continue; }
    const r = await translateSnap(d, false);
    if (!r.ok && AI_DOWN.test(r.error || "")) return;
  }
}
