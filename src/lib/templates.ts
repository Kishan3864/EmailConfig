import type { Settings } from "./settings";
import type { LeadExtra } from "./fsdb";
import { siteStatus, type SiteStatus } from "./website";

/*
 * Fixed mail templates (Settings → Email templates). A campaign fills them for every lead instead of asking the AI:
 *   mailType "tpl1".."tpl6": one template for every lead
 *   mailType "bysite":       1-3 templates for leads without a website of their own (tplNoSiteIds) and 1-3 for leads with
 *                            one (tplSiteIds, lib/website.ts); the leads of a group get its templates in turn (round-robin)
 * Each template has a group (tplNFor: nosite | site | any = fits both) and a language (tplNLang, "" = read from its text).
 * Placeholders:
 *   {{business}} {{contact}} {{city}} {{category}} {{country}}  - from the lead (import file)
 *   {{website}}                                                 - the lead's own website domain, e.g. bellavista.fr
 *   {{reviews}} {{rating}}                                      - Google review count and rating (import file)
 *   {{observation}}                                             - one real problem I saw on their website (import file)
 *   {{my_name}} {{my_business}}                                - from Settings (sender profile)
 * {{name|text}} uses "text" when the lead has no value, e.g. "Hello {{contact|there}}," or "in {{city|your area}}".
 * {{observation}} never falls back: without it the draft waits for my own words ("Text chahiye"), see fillForLead.
 */
export const TEMPLATE_IDS = ["tpl1", "tpl2", "tpl3", "tpl4", "tpl5", "tpl6"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
export const BY_SITE = "bysite";
export const MAIL_TYPES = ["ai", BY_SITE, ...TEMPLATE_IDS] as const;
/** At most this many templates per group in a "by website" campaign. */
export const MAX_PER_GROUP = 3;

export const TEMPLATE_FOR = ["any", "nosite", "site"] as const;
export type TemplateFor = (typeof TEMPLATE_FOR)[number];
export type Group = Exclude<TemplateFor, "any">;
export const toTemplateFor = (v?: string | null): TemplateFor => ((TEMPLATE_FOR as readonly string[]).includes(v || "") ? (v as TemplateFor) : "any");

export const isTemplateId = (v?: string | null): v is TemplateId => !!v && (TEMPLATE_IDS as readonly string[]).includes(v);

/** "Template 3" */
export const tplNo = (id: TemplateId) => `Template ${id.slice(3)}`;

/** lang: the language set in Settings ("" = not set: read it from the text with detectLang). */
export function templateOf(s: Settings, id: TemplateId) {
  return { id, name: s[`${id}Name`], subject: s[`${id}Subject`], body: s[`${id}Body`], for: toTemplateFor(s[`${id}For`]), lang: s[`${id}Lang`] || "" };
}

/** "Template 3: Paris vrai site (FR)", or "Template 3" when it has no name. */
export function templateLabel(s: Settings, id: TemplateId) {
  const n = (s[`${id}Name`] || "").trim();
  return n ? `${tplNo(id)}: ${n}` : tplNo(id);
}

type LeadVars = LeadExtra & { businessName?: string | null; country?: string | null; website?: string | null };

export function templateVars(lead: LeadVars, s: Settings): Record<string, string> {
  const site = siteStatus(lead.website);
  return {
    business: lead.businessName || "",
    contact: lead.contactName || "",
    city: lead.city || "",
    category: lead.category || "",
    country: lead.country || "",
    website: site.has ? site.domain : "",
    reviews: lead.reviews || "",
    rating: lead.rating || "",
    observation: lead.observation || "",
    my_name: s.senderName || "",
    my_business: s.business || "",
  };
}

/** Marks where a placeholder came out empty, so only that spot is tidied up. */
const EMPTY = "\u0000";
const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi;

/**
 * Fills the placeholders. Where a value is empty, the space left before punctuation is removed ("Hello {{contact}},"
 * → "Hello,"). Spaces the template itself puts before punctuation stay: French writes "intéresse ?" and "tout : le".
 */
export function fillTemplate(text: string, vars: Record<string, string>) {
  return text
    .replace(PLACEHOLDER, (_, k: string, def?: string) => (vars[k.toLowerCase()] || "").trim() || (def || "").trim() || EMPTY)
    .split("\n")
    .map((l) => l.replace(/(?:[ \t  ]*\u0000)+(?=[ \t  ]*[,.!?;:])/g, "").replace(/\u0000/g, "").replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .trim();
}

/** Details a mail must never go out without and never get a stand-in for: a missing one means I write that part myself. */
export const MUST_BE_REAL = ["observation"] as const;
/** What a draft shows where such a detail is missing; the draft rules refuse it, so it cannot be approved until I replace it. */
export const missingMark = (k: string) => `[${k.toUpperCase()}]`;

/**
 * Fills a template (or the lead's own text) for one lead. A {{observation}} the lead has no value for is not filled
 * from its |fallback: it becomes [OBSERVATION] and `missing` lists it, so the draft waits as "Text chahiye".
 */
export function fillForLead(subject: string, body: string, vars: Record<string, string>) {
  const missing = new Set<string>();
  const mark = (text: string) => text.replace(PLACEHOLDER, (all, k: string) => {
    const key = k.toLowerCase();
    if ((MUST_BE_REAL as readonly string[]).includes(key) && !(vars[key] || "").trim()) { missing.add(key); return missingMark(key); }
    return all;
  });
  return { subject: fillTemplate(mark(subject), vars), body: fillTemplate(mark(body), vars), missing: [...missing] };
}

/** Every value a placeholder can put into a mail: their capitals (e.g. "CAFÉ DE CHIRAZ") are not my own ALL CAPS. */
export const capsAllowed = (vars: Record<string, string>) => Object.values(vars).filter(Boolean);

type CampaignTpl = { mailType?: string | null; tplNoSite?: string | null; tplSite?: string | null; tplNoSiteIds?: string[] | null; tplSiteIds?: string[] | null };

/** How a campaign's mails are made. A campaign without a mailType is an AI campaign. */
export type MailPlan = { kind: "ai" } | { kind: "one"; id: TemplateId } | { kind: "bysite"; nosite: TemplateId[]; site: TemplateId[] };

const validIds = (ids?: (string | null | undefined)[] | null) => [...new Set((ids || []).filter(isTemplateId))].slice(0, MAX_PER_GROUP);

export function mailPlan(c: CampaignTpl): MailPlan {
  if (c.mailType === BY_SITE) {
    // newer campaigns store 1-3 per group, older ones a single id; if a group were ever empty, the other one is used
    let nosite = validIds(c.tplNoSiteIds?.length ? c.tplNoSiteIds : [c.tplNoSite]);
    let site = validIds(c.tplSiteIds?.length ? c.tplSiteIds : [c.tplSite]);
    if (!nosite.length) nosite = site.length ? site : ["tpl1"];
    if (!site.length) site = nosite;
    return { kind: "bysite", nosite, site };
  }
  return isTemplateId(c.mailType) ? { kind: "one", id: c.mailType } : { kind: "ai" };
}

/** Every template a campaign uses (none for an AI campaign). */
export function planTemplates(p: MailPlan): TemplateId[] {
  return p.kind === "one" ? [p.id] : p.kind === "bysite" ? [...new Set([...p.nosite, ...p.site])] : [];
}

/**
 * The templates a lead of this campaign can get and why: group (null for a one-template campaign) and website status.
 * null for an AI campaign.
 */
export function templatesForLead(c: CampaignTpl, website?: string | null): { ids: TemplateId[]; group: Group | null; site: SiteStatus } | null {
  const p = mailPlan(c);
  if (p.kind === "ai") return null;
  const site = siteStatus(website);
  if (p.kind === "one") return { ids: [p.id], group: null, site };
  return site.has ? { ids: p.site, group: "site", site } : { ids: p.nosite, group: "nosite", site };
}

/** Round-robin: the n-th draft of a group (counted from 0) gets the template at n modulo the group's size. */
export const rotate = <T,>(ids: readonly T[], n: number) => ids[((n % ids.length) + ids.length) % ids.length];

/**
 * The template a lead gets, for showing it: `used` (the draft's own tplId) when it is one of the lead's templates,
 * else the first of them. Drafts store the template they were really made from, so prefer that where there is one.
 */
export function templateForLead(c: CampaignTpl, website?: string | null, used?: string | null): { id: TemplateId; site: SiteStatus } | null {
  const t = templatesForLead(c, website);
  if (!t) return null;
  return { id: isTemplateId(used) && t.ids.includes(used) ? used : t.ids[0], site: t.site };
}

/**
 * The templates the campaign form ticks for a group: the ones in that group written in the campaign's language, up
 * to 3; else the ones fitting both groups in that language. None in that language: nothing is ticked, so I choose
 * myself (a template in another language would make every draft fail).
 */
export function suggestGroup(tpls: { id: TemplateId; for: TemplateFor; lang: string }[], lang: string, group: Group): TemplateId[] {
  const pick = (ok: (x: { for: TemplateFor; lang: string }) => boolean) => tpls.filter(ok).map((x) => x.id).slice(0, MAX_PER_GROUP);
  const own = pick((x) => x.for === group && x.lang === lang);
  return own.length ? own : pick((x) => x.for === "any" && x.lang === lang);
}
