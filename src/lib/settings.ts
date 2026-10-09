import { prisma } from "./db";

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
  domain: "", dkimSelector: "hostingermail1",
  dryRun: true,
};

export async function getSettings(): Promise<Settings> {
  const row = await prisma.kV.findUnique({ where: { key: "settings" } });
  return { ...DEFAULTS, ...(row ? JSON.parse(row.value) : {}) };
}

export async function saveSettings(s: Partial<Settings>) {
  const cur = await getSettings();
  const value = JSON.stringify({ ...cur, ...s });
  await prisma.kV.upsert({ where: { key: "settings" }, create: { key: "settings", value }, update: { value } });
}

export type State = {
  globalStop: boolean;
  alert: { message: string; at: string } | null;
  nextSendAt: string | null;
  imapUidValidity: string | null; imapLastUid: number;
  lastSyncAt: string | null; lastWorkerTick: string | null;
  aiBackoffUntil: string | null;
  dns: { spf: boolean; dkim: boolean; dmarc: boolean; detail: string; at: string } | null;
};

const STATE_DEFAULT: State = {
  globalStop: false, alert: null, nextSendAt: null, imapUidValidity: null, imapLastUid: 0,
  lastSyncAt: null, lastWorkerTick: null, aiBackoffUntil: null, dns: null,
};

export async function getState(): Promise<State> {
  const row = await prisma.kV.findUnique({ where: { key: "state" } });
  return { ...STATE_DEFAULT, ...(row ? JSON.parse(row.value) : {}) };
}

export async function setState(s: Partial<State>) {
  const cur = await getState();
  const value = JSON.stringify({ ...cur, ...s });
  await prisma.kV.upsert({ where: { key: "state" }, create: { key: "state", value }, update: { value } });
}
