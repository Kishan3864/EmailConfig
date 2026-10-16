import type { Settings } from "./settings";
import type { LeadExtra } from "./fsdb";
import { siteStatus, type SiteStatus } from "./website";

/*
 * Fixed mail templates (Settings → Email templates). A campaign fills them for every lead instead of asking the AI:
 *   mailType "tpl1".."tpl6": one template for every lead
 *   mailType "bysite":       tplNoSite for leads without a website of their own, tplSite for leads with one (lib/website.ts)
 * Each template is tagged with whom it is written for (tplNFor: any | nosite | site); the campaign form uses the tag
 * to suggest the pair. Placeholders:
 *   {{business}} {{contact}} {{city}} {{category}} {{country}}  - from the lead (import file)
 *   {{website}}                                                 - the lead's own website domain, e.g. bellavista.fr
 *   {{my_name}} {{my_business}}                                - from Settings (sender profile)
 * {{name|text}} uses "text" when the lead has no value, e.g. "Hello {{contact|there}}," or "in {{city|your area}}".
 */
export const TEMPLATE_IDS = ["tpl1", "tpl2", "tpl3", "tpl4", "tpl5", "tpl6"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
export const BY_SITE = "bysite";
export const MAIL_TYPES = ["ai", BY_SITE, ...TEMPLATE_IDS] as const;

export const TEMPLATE_FOR = ["any", "nosite", "site"] as const;
export type TemplateFor = (typeof TEMPLATE_FOR)[number];
export const toTemplateFor = (v?: string | null): TemplateFor => ((TEMPLATE_FOR as readonly string[]).includes(v || "") ? (v as TemplateFor) : "any");

export const isTemplateId = (v?: string | null): v is TemplateId => !!v && (TEMPLATE_IDS as readonly string[]).includes(v);

/** "Template 3" */
export const tplNo = (id: TemplateId) => `Template ${id.slice(3)}`;

export function templateOf(s: Settings, id: TemplateId) {
  return { id, name: s[`${id}Name`], subject: s[`${id}Subject`], body: s[`${id}Body`], for: toTemplateFor(s[`${id}For`]) };
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
    my_name: s.senderName || "",
    my_business: s.business || "",
  };
}

/** Marks where a placeholder came out empty, so only that spot is tidied up. */
const EMPTY = "\u0000";

/**
 * Fills the placeholders. Where a value is empty, the space left before punctuation is removed ("Hello {{contact}},"
 * → "Hello,"). Spaces the template itself puts before punctuation stay: French writes "intéresse ?" and "tout : le".
 */
export function fillTemplate(text: string, vars: Record<string, string>) {
  return text
    .replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (_, k: string, def?: string) => (vars[k.toLowerCase()] || "").trim() || (def || "").trim() || EMPTY)
    .split("\n")
    .map((l) => l.replace(/(?:[ \t  ]*\u0000)+(?=[ \t  ]*[,.!?;:])/g, "").replace(/\u0000/g, "").replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .trim();
}

type CampaignTpl = { mailType?: string | null; tplNoSite?: string | null; tplSite?: string | null };

/** How a campaign's mails are made. A campaign without a mailType is an AI campaign. */
export type MailPlan = { kind: "ai" } | { kind: "one"; id: TemplateId } | { kind: "bysite"; nosite: TemplateId; site: TemplateId };

export function mailPlan(c: CampaignTpl): MailPlan {
  if (c.mailType === BY_SITE) {
    // createCampaign always stores both; if one were ever missing, the other is used for every lead
    const nosite = isTemplateId(c.tplNoSite) ? c.tplNoSite : isTemplateId(c.tplSite) ? c.tplSite : "tpl1";
    const site = isTemplateId(c.tplSite) ? c.tplSite : nosite;
    return { kind: "bysite", nosite, site };
  }
  return isTemplateId(c.mailType) ? { kind: "one", id: c.mailType } : { kind: "ai" };
}

/** Every template a campaign uses (none for an AI campaign). */
export function planTemplates(p: MailPlan): TemplateId[] {
  return p.kind === "one" ? [p.id] : p.kind === "bysite" ? [...new Set([p.nosite, p.site])] : [];
}

/** The template a lead of this campaign gets, and the website status that chose it; null for an AI campaign. */
export function templateForLead(c: CampaignTpl, website?: string | null): { id: TemplateId; site: SiteStatus } | null {
  const p = mailPlan(c);
  if (p.kind === "ai") return null;
  const site = siteStatus(website);
  return { id: p.kind === "one" ? p.id : site.has ? p.site : p.nosite, site };
}

/**
 * The pair the campaign form suggests for a language: a template tagged for that group and written in the
 * campaign's language, else an "any" template in that language, else one tagged for the group, else the first.
 */
export function suggestPair(tpls: { id: TemplateId; for: TemplateFor; lang: string }[], lang: string) {
  const pick = (f: TemplateFor) =>
    (tpls.find((x) => x.for === f && x.lang === lang) ?? tpls.find((x) => x.for === "any" && x.lang === lang) ?? tpls.find((x) => x.for === f) ?? tpls[0])?.id ?? "tpl1";
  return { nosite: pick("nosite"), site: pick("site") };
}
