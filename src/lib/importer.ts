import type { CollectionReference } from "firebase-admin/firestore";
import { C, key } from "./fsdb";
import { hasMx } from "./dnscheck";
import { getAllChunked } from "./ledger";

export type InRow = { email?: string; businessName?: string; website?: string; phone?: string; country?: string; chain?: string; raw?: string };
export type OutRow = InRow & { rowNo: number; outcome: "send" | "skip" | "review"; reason?: string; businessKey?: string };

export const ROLE_WORDS = ["dpo", "privacy", "rgpd", "gdpr", "legal", "abuse", "postmaster", "noreply", "no-reply", "donotreply", "press", "presse", "jobs", "job", "recrutement", "recruiting", "recruitment", "hr", "rh", "careers", "career", "franchise", "webmaster", "mailer-daemon"];
const PREFERRED = ["contact", "info", "hello", "bonjour", "hola", "hallo", "ciao", "office", "enquiries", "inquiries", "reservation", "reservations", "booking", "accueil"];
const GENERIC = new Set([...PREFERRED, "sales", "admin", "team", "shop", "store", "studio", "support", "service", "mail", "email", "commande", "commandes", "order", "orders", "secretariat", "direction", "agence", "cabinet", "salon", "restaurant", "hotel", "bureau", "atelier", "boutique", "magasin", "welcome", "infos", "information", "rdv", "devis", "clients", "client"]);
export const FREEMAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.fr", "yahoo.co.uk", "hotmail.com", "hotmail.fr", "hotmail.co.uk", "outlook.com", "outlook.fr", "live.com", "live.fr", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "laposte.net", "neuf.fr", "bbox.fr", "gmx.com", "gmx.de", "gmx.fr", "web.de", "t-online.de", "proton.me", "protonmail.com", "yandex.com", "mail.com", "zoho.com", "libero.it", "rediffmail.com", "ymail.com"]);

const EMAIL_RE = /^[a-z0-9.!#$%&*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/;

export const normEmail = (e?: string) => (e || "").trim().toLowerCase().replace(/^mailto:/, "").replace(/[<>"';,]/g, "");
export const validSyntax = (e: string) => EMAIL_RE.test(e) && !e.includes("..") && !e.startsWith(".") && e.length <= 254;
export const emailDomain = (e: string) => e.split("@")[1] || "";
export const localPart = (e: string) => e.split("@")[0] || "";

export function siteDomain(w?: string | null) {
  if (!w) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(w.trim()) ? w.trim() : "http://" + w.trim());
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch { return ""; }
}

export function roleWord(e: string) {
  const lp = localPart(e);
  return ROLE_WORDS.find((w) => lp === w || [".", "-", "_"].some((s) => lp.startsWith(w + s) || lp.endsWith(s + w)));
}

export const isPreferred = (e: string) => PREFERRED.some((p) => localPart(e) === p || localPart(e).startsWith(p + "."));

/** Looks like a private person's name (john.smith@, j.smith@, johnsmith@gmail) */
export function looksPersonal(e: string) {
  const lp = localPart(e).replace(/\d+$/, "");
  const dom = emailDomain(e);
  if (GENERIC.has(lp) || isPreferred(e)) return false;
  const brand = dom.split(".")[0];
  if (brand.length > 3 && lp.includes(brand)) return false;
  const parts = lp.split(/[._-]/).filter(Boolean);
  if (parts.length === 2 && parts.every((p) => /^[a-zà-ÿ]+$/.test(p) && p.length <= 15) && !parts.some((p) => GENERIC.has(p))) return true;
  if (FREEMAIL.has(dom)) return true; // free-mail + non-generic local part: probably a person
  return false;
}

function pickEmail(cell?: string) {
  const cands = (cell || "").split(/[\s;,|/]+/).map(normEmail).filter(Boolean);
  const valid = cands.filter(validSyntax);
  const good = valid.filter((e) => !roleWord(e));
  return good.find(isPreferred) || good[0] || valid[0] || cands[0] || "";
}

const truthy = (v?: string) => !!v && /^(1|y|yes|true|oui|x|chain|chaine|chaîne)$/i.test(v.trim());

export async function processRows(rows: InRow[]): Promise<OutRow[]> {
  const out: OutRow[] = rows.map((r, i) => ({ ...r, email: pickEmail(r.email), rowNo: i + 1, outcome: "send" as const }));

  // look up everything this file touches in Firestore: ledger, existing leads, suppression
  const emails = [...new Set(out.map((r) => r.email!).filter(validSyntax))];
  const bizKeys = [...new Set(out.flatMap((r) => (r.email && validSyntax(r.email) ? [siteDomain(r.website) || (FREEMAIL.has(emailDomain(r.email)) ? r.email : emailDomain(r.email))] : [])))];
  const doms = [...new Set(out.flatMap((r) => [r.email ? emailDomain(r.email) : "", siteDomain(r.website)]).filter(Boolean))];
  const exists = async (col: CollectionReference, ids: string[]) => {
    const snaps = await getAllChunked(ids.map((i) => col.doc(key(i))));
    return new Set(ids.filter((_, i) => snaps[i].exists));
  };
  const [contacted, contactedBiz, exEmail, exBiz, suppSet] = await Promise.all([
    exists(C.contacted, emails), exists(C.contactedBiz, bizKeys), exists(C.leads, emails), exists(C.businesses, bizKeys), exists(C.suppression, [...emails, ...doms]),
  ]);

  // chain counts: same domain or same email on 3+ rows
  const domCount = new Map<string, number>(), emCount = new Map<string, number>();
  for (const r of out) {
    if (!r.email) continue;
    emCount.set(r.email, (emCount.get(r.email) || 0) + 1);
    const d = siteDomain(r.website) || (FREEMAIL.has(emailDomain(r.email)) ? "" : emailDomain(r.email));
    if (d) domCount.set(d, (domCount.get(d) || 0) + 1);
  }

  const skip = (r: OutRow, reason: string) => { r.outcome = "skip"; r.reason = reason; };

  for (const r of out) {
    const e = r.email!;
    if (!e) { skip(r, "no email"); continue; }
    if (!validSyntax(e)) { skip(r, "invalid syntax"); continue; }
    const rw = roleWord(e);
    if (rw) { skip(r, `role address (${rw})`); continue; }
    const ed = emailDomain(e);
    const sd = siteDomain(r.website);
    if (suppSet.has(e) || suppSet.has(ed) || (sd && suppSet.has(sd))) { skip(r, "suppressed"); continue; }
    if (contacted.has(e)) { skip(r, "already contacted (in Firebase ledger)"); continue; }
    if (exEmail.has(e)) { skip(r, "already imported in an earlier list"); continue; }
    const bizDom = sd || (FREEMAIL.has(ed) ? "" : ed);
    if (truthy(r.chain)) { skip(r, "marked as chain"); continue; }
    if ((emCount.get(e) || 0) >= 3 || (bizDom && (domCount.get(bizDom) || 0) >= 3)) { skip(r, "chain (3+ rows share this domain/email)"); continue; }
    r.businessKey = bizDom || e;
    if (contactedBiz.has(r.businessKey)) { skip(r, "business already contacted (in Firebase ledger)"); continue; }
    if (exBiz.has(r.businessKey)) { skip(r, "business already imported in an earlier list"); continue; }
  }

  // one per business inside the file: prefer contact@/info@/hello@...
  const groups = new Map<string, OutRow[]>();
  for (const r of out) if (r.outcome !== "skip" && r.businessKey) groups.set(r.businessKey, [...(groups.get(r.businessKey) || []), r]);
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const keep = g.find((r) => isPreferred(r.email!)) || g[0];
    for (const r of g) if (r !== keep) skip(r, `duplicate business (kept ${keep.email})`);
  }

  // MX lookups (limited concurrency)
  const todo = out.filter((r) => r.outcome !== "skip");
  const domains = [...new Set(todo.map((r) => emailDomain(r.email!)))];
  const mx = new Map<string, boolean>();
  for (let i = 0; i < domains.length; i += 10) {
    await Promise.all(domains.slice(i, i + 10).map(async (d) => mx.set(d, await hasMx(d))));
  }
  for (const r of todo) {
    if (!mx.get(emailDomain(r.email!))) { skip(r, "no MX record"); continue; }
    if (looksPersonal(r.email!)) { r.outcome = "review"; r.reason = "looks like a private person's address"; }
  }
  return out;
}
