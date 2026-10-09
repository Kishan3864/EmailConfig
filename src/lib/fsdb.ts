import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore, type Query, type QuerySnapshot } from "firebase-admin/firestore";

// Firestore (Admin SDK). Credentials:
//  - on Firebase (App Hosting / Cloud Functions): automatic
//  - locally: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json  (or FIREBASE_SERVICE_ACCOUNT='{json}')
function init(): Firestore {
  const g = globalThis as unknown as { __fsdb?: Firestore };
  if (g.__fsdb) return g.__fsdb;
  let app: App | undefined = getApps()[0];
  if (!app) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    app = sa ? initializeApp({ credential: cert(JSON.parse(sa)) }) : initializeApp(process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : undefined);
  }
  const db = getFirestore(app, process.env.FIRESTORE_DATABASE_ID || "outreach");
  db.settings({ ignoreUndefinedProperties: true });
  g.__fsdb = db;
  return db;
}

export const db = init();

export const C = {
  kv: db.collection("kv"),
  contacted: db.collection("contacted"), // PERMANENT ledger: every address ever emailed (never deleted)
  contactedBiz: db.collection("contactedBiz"), // PERMANENT ledger: every business ever emailed
  leads: db.collection("leads"), // doc id = email key  -> one lead per address, ever
  businesses: db.collection("businesses"), // doc id = business key -> one lead per business, ever
  lists: db.collection("lists"),
  campaigns: db.collection("campaigns"),
  messages: db.collection("messages"), // doc id = lead id -> exactly one message per lead
  sendLogs: db.collection("sendLogs"),
  draftJobs: db.collection("draftJobs"),
  suppression: db.collection("suppression"), // doc id = email or domain key
  replies: db.collection("replies"),
  logs: db.collection("logs"),
};

export const nowIso = () => new Date().toISOString();

/** Firestore-safe document id for an email / domain (ids cannot contain "/") */
export const key = (s: string) => s.trim().toLowerCase().replace(/\//g, "%2F");

export function rows<T>(snap: QuerySnapshot): T[] {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
}

export async function count(q: Query) {
  return (await q.count().get()).data().count;
}

export type Lead = {
  id: string; email: string; businessKey: string; businessName?: string; website?: string; phone?: string; country?: string;
  listId: string; campaignId?: string | null;
  // ready | needs_review | rejected | sent | check_manual | bounced | replied | opted_out | failed | suppressed | already_contacted
  status: string; facts?: string; factsAt?: string; dryRunAt?: string; createdAt: string; updatedAt: string;
};
export type Campaign = { id: string; name: string; listId: string; timezone: string; language: string; status: string; samplesApproved: boolean; createdAt: string; startedAt?: string };
export type Message = {
  id: string; leadId: string; leadEmail: string; businessName?: string; campaignId: string; language: string;
  subject: string; body: string; subjectEn?: string | null; bodyEn?: string | null;
  // ready | sending | sent | retry | check_manual | failed | bounced | blocked
  status: string; attempts: number; dryRunDone: boolean; nextAttemptAt?: string; sendStartedAt?: string; sentAt?: string;
  messageId?: string; smtpResponse?: string; error?: string; createdAt: string;
};
export type LeadList = { id: string; name: string; sourceNote: string; confirmed: boolean; createdAt: string; counts?: Record<string, number> };
export type ImportRow = { id: string; rowNo: number; email?: string; businessName?: string; website?: string; phone?: string; country?: string; outcome: string; reason?: string; businessKey?: string };
export type SendLog = { id: string; messageId?: string; leadId?: string; to: string; dryRun: boolean; ok: boolean; response: string; at: string };
export type Reply = { id: string; leadId?: string | null; kind: string; fromEmail: string; subject?: string; body: string; bodyEn?: string | null; messageId?: string; receivedAt: string };
export type Suppression = { id: string; value: string; kind: string; reason: string; createdAt: string };
export type Contacted = { id: string; email: string; status: string; source: string; leadId?: string; messageRef?: string; at: string; note?: string };
export type LogRow = { id: string; level: string; scope: string; message: string; at: string };
export type EventRow = { id: string; type: string; detail?: string; at: string };
