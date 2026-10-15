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
  signatureLogo: boolean; // HTML mail with the logo embedded in the signature
  approveEach: boolean; // every draft must be approved by me before it can be sent
  fromName: string; // name shown in the lead's inbox; blank = business name, then sender name
  // three fixed mail templates a campaign can use instead of the AI (placeholders: see lib/templates.ts)
  tpl1Name: string; tpl1Subject: string; tpl1Body: string;
  tpl2Name: string; tpl2Subject: string; tpl2Body: string;
  tpl3Name: string; tpl3Subject: string; tpl3Body: string;
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
  signatureLogo: false,
  approveEach: true,
  fromName: "",
  tpl1Name: "Website intro",
  tpl1Subject: "a website idea for {{business}}",
  tpl1Body: [
    "Hello {{contact|there}},",
    "",
    "I'm writing from {{my_business}}. We build clear, fast websites for local businesses like {{business}} in {{city|your area}}, so that new customers can understand what you offer and contact you in a few seconds, also from a phone.",
    "",
    "We take care of everything: design, text, layout and the technical setup. You only tell us what matters for {{business}} and give feedback on the first version.",
    "",
    "Would it be useful if I sent you two or three ideas for {{business}}, without any obligation?",
  ].join("\n"),
  tpl2Name: "More enquiries",
  tpl2Subject: "more enquiries for {{business}}",
  tpl2Body: [
    "Hello {{contact|there}},",
    "",
    "I'm getting in touch with {{business}} to introduce {{my_business}}. We design websites for local businesses that help turn visitors into calls, messages and bookings.",
    "",
    "A typical site we build has a clear page about your services, your opening hours and location, an easy contact or booking button on phones, and simple updates whenever you need them.",
    "",
    "If it helps, I can prepare a short example of how a page for {{business}} could look. Would that be interesting for you?",
  ].join("\n"),
  tpl3Name: "Short and direct",
  tpl3Subject: "website for {{business}}",
  tpl3Body: [
    "Hello {{contact|there}},",
    "",
    "This is {{my_business}}. We create websites for small businesses that look professional, work well on phones and make it easy for new customers to get in touch.",
    "",
    "The process is simple: a short call to understand what you offer, a first design you can review, and changes until you are happy with it. You don't need any technical knowledge.",
    "",
    "If a new or refreshed website is on your list this year, would you like me to share a few examples of our recent work?",
  ].join("\n"),
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
  sendDays: string[]; lastDraftAt: string | null; lastSummaryDay: string | null;
};

const STATE_DEFAULT: State = {
  globalStop: false, alert: null, nextSendAt: null, imapUidValidity: null, imapLastUid: 0,
  lastSyncAt: null, lastWorkerTick: null, aiBackoffUntil: null, dns: null, sendDays: [], lastDraftAt: null, lastSummaryDay: null,
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
