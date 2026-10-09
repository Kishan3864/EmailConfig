import { FieldValue } from "firebase-admin/firestore";
import { C } from "./fsdb";

export type Settings = {
  smtpHost: string; smtpPort: number; smtpSecure: boolean; smtpUser: string;
  imapHost: string; imapPort: number; imapSecure: boolean; imapUser: string;
  fromEmail: string; testEmail: string; alertEmail: string;
  senderName: string; senderRole: string; business: string; website: string; portfolio: string; postalAddress: string;
  offerWhat: string; offerProof: string; offerTone: string;
  sendDays: number[]; // 1=Mon .. 7=Sun
  windowStart: string; windowEnd: string; // HH:MM in campaign timezone
  gapMinMin: number; gapMaxMin: number;
  warmStart: number; warmStep: number; warmMax: number; planDailyLimit: number;
  aiBaseUrl: string; aiModel: string;
  domain: string; dkimSelector: string;
  dryRun: boolean;
};

export const DEFAULTS: Settings = {
  smtpHost: "smtp.hostinger.com", smtpPort: 465, smtpSecure: true, smtpUser: "",
  imapHost: "imap.hostinger.com", imapPort: 993, imapSecure: true, imapUser: "",
  fromEmail: "", testEmail: "", alertEmail: "",
  senderName: "", senderRole: "Web designer", business: "", website: "", portfolio: "", postalAddress: "",
  offerWhat: "Website design and redesign for small businesses: fast, mobile-friendly sites with clear booking/contact.",
  offerProof: "", offerTone: "Friendly, short, honest, no hype.",
  sendDays: [1, 2, 3, 4, 5], windowStart: "09:30", windowEnd: "17:30",
  gapMinMin: 5, gapMaxMin: 15,
  warmStart: 10, warmStep: 5, warmMax: 30, planDailyLimit: 100,
  aiBaseUrl: "https://api.openai.com/v1", aiModel: "gpt-4o-mini",
  domain: "", dkimSelector: "hostingermail-a",
  dryRun: true,
};

export async function getSettings(): Promise<Settings> {
  const d = await C.kv.doc("settings").get();
  return { ...DEFAULTS, ...(d.exists ? d.data() : {}) } as Settings;
}

export async function saveSettings(s: Partial<Settings>) {
  await C.kv.doc("settings").set(s, { merge: true });
}

export type State = {
  globalStop: boolean;
  alert: { message: string; at: string } | null;
  nextSendAt: string | null;
  imapUidValidity: string | null; imapLastUid: number;
  lastSyncAt: string | null; lastWorkerTick: string | null;
  aiBackoffUntil: string | null;
  dns: { spf: boolean; dkim: boolean; dmarc: boolean; detail: string; at: string } | null;
  sendDays: string[]; lastDraftAt: string | null;
};

const STATE_DEFAULT: State = {
  globalStop: false, alert: null, nextSendAt: null, imapUidValidity: null, imapLastUid: 0,
  lastSyncAt: null, lastWorkerTick: null, aiBackoffUntil: null, dns: null, sendDays: [], lastDraftAt: null,
};

export async function getState(): Promise<State> {
  const d = await C.kv.doc("state").get();
  return { ...STATE_DEFAULT, ...(d.exists ? d.data() : {}) } as State;
}

/** Merge-write only the given fields, so the web app and the worker never overwrite each other's fields. */
export async function setState(s: Partial<State>) {
  await C.kv.doc("state").set(s, { merge: true });
}

/** Record a day (in a timezone) on which live mail was sent; used for warm-up. */
export async function addSendDay(tz: string, dayKey: string) {
  await C.kv.doc("state").set({ sendDays: FieldValue.arrayUnion(`${tz}|${dayKey}`) }, { merge: true });
}
