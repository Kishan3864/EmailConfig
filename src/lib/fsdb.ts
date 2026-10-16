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
  const db = getFirestore(app, process.env.FIRESTORE_DATABASE_ID || "(default)");
  db.settings({ ignoreUndefinedProperties: true });
  g.__fsdb = db;
  return db;
}

export const db = init();

// All outreach collections share one prefix, so they can live in the project's existing database
// next to the website's own collections without ever colliding with them.
const P = process.env.FIRESTORE_PREFIX ?? "outreach_";
export const EVENTS = P + "events"; // subcollection of a lead

export const C = {
  kv: db.collection(P + "kv"),
  contacted: db.collection(P + "contacted"), // PERMANENT ledger: every address ever emailed (never deleted)
  contactedBiz: db.collection(P + "contactedBiz"), // PERMANENT ledger: every business ever emailed
  leads: db.collection(P + "leads"), // doc id = email key  -> one lead per address, ever
  businesses: db.collection(P + "businesses"), // doc id = business key -> one lead per business, ever
  lists: db.collection(P + "lists"),
  campaigns: db.collection(P + "campaigns"),
  messages: db.collection(P + "messages"), // doc id = lead id -> exactly one message per lead
  sendLogs: db.collection(P + "sendLogs"),
  draftJobs: db.collection(P + "draftJobs"),
  suppression: db.collection(P + "suppression"), // doc id = email or domain key
  replies: db.collection(P + "replies"),
  logs: db.collection(P + "logs"),
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

/** Extra facts about a lead from the import file. The AI may use only these (and the lead's own website description). */
export type LeadExtra = { contactName?: string | null; city?: string | null; category?: string | null; about?: string | null; note?: string | null };
export type Lead = LeadExtra & {
  id: string; email: string; businessKey: string; businessName?: string; website?: string; phone?: string; country?: string;
  listId: string; campaignId?: string | null;
  // ready | needs_review | rejected | sent | check_manual | bounced | replied | opted_out | failed | suppressed | already_contacted
  status: string; facts?: string; factsAt?: string; dryRunAt?: string; createdAt: string; updatedAt: string;
};
/**
 * mailType: "ai" (AI writes each mail; also when missing), "tpl1".."tpl6" (one fixed template from Settings for every lead)
 * or "bysite" (tplNoSite for leads without a website of their own, tplSite for leads with one). See lib/templates.ts.
 */
export type Campaign = {
  id: string; name: string; listId: string; timezone: string; language: string; status: string; samplesApproved: boolean; createdAt: string; startedAt?: string;
  mailType?: string; tplNoSite?: string | null; tplSite?: string | null;
  siteSplit?: { site: number; nosite: number }; // "bysite": leads with / without their own website when it was created
};
export type Message = {
  id: string; leadId: string; leadEmail: string; businessName?: string; campaignId: string; language: string;
  subject: string; body: string;
  // the English version, only for me to check (lib/translate.ts): enFor = textKey of the text it was made from,
  // enNeeded = it is still missing, enRetryAt = when the worker tries (again), enTries / enError / enAt = failed tries
  subjectEn?: string | null; bodyEn?: string | null; enFor?: string | null; enNeeded?: boolean; enRetryAt?: string | null; enTries?: number;
  enError?: string | null; enAt?: string | null;
  tplId?: string | null; // the template this draft was filled from (null = written by the AI)
  edited?: boolean; approved?: boolean;
  // ready | sending | sent | retry | check_manual | failed | bounced | blocked
  status: string; attempts: number; dryRunDone: boolean; nextAttemptAt?: string; sendStartedAt?: string; sentAt?: string;
  messageId?: string; smtpResponse?: string; error?: string; createdAt: string;
};
export type LeadList = { id: string; name: string; sourceNote: string; confirmed: boolean; createdAt: string; counts?: Record<string, number> };
export type ImportRow = LeadExtra & { id: string; rowNo: number; email?: string; businessName?: string; website?: string; phone?: string; country?: string; outcome: string; reason?: string; businessKey?: string };
export type SendLog = { id: string; messageId?: string; leadId?: string; to: string; dryRun: boolean; ok: boolean; response: string; at: string };
export type Reply = { id: string; leadId?: string | null; kind: string; fromEmail: string; subject?: string; body: string; bodyEn?: string | null; messageId?: string; receivedAt: string };
export type Suppression = { id: string; value: string; kind: string; reason: string; createdAt: string };
export type Contacted = { id: string; email: string; status: string; source: string; leadId?: string; messageRef?: string; at: string; note?: string };
export type LogRow = { id: string; level: string; scope: string; message: string; at: string };
export type EventRow = { id: string; type: string; detail?: string; at: string };
