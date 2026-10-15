import type { Settings } from "./settings";
import type { LeadExtra } from "./fsdb";

/*
 * Fixed mail templates (Settings → Email templates). A campaign with mailType "tpl1".."tpl3" fills one of them
 * for every lead instead of asking the AI. Placeholders:
 *   {{business}} {{contact}} {{city}} {{category}} {{country}}  - from the lead (import file)
 *   {{my_name}} {{my_business}}                                - from Settings (sender profile)
 * {{name|text}} uses "text" when the lead has no value, e.g. "Hello {{contact|there}}," or "in {{city|your area}}".
 */
export const TEMPLATE_IDS = ["tpl1", "tpl2", "tpl3"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
export const MAIL_TYPES = ["ai", ...TEMPLATE_IDS] as const;

export const isTemplateId = (v?: string | null): v is TemplateId => !!v && (TEMPLATE_IDS as readonly string[]).includes(v);

export function templateOf(s: Settings, id: TemplateId) {
  const n = id.slice(3) as "1" | "2" | "3";
  return { id, name: s[`tpl${n}Name`], subject: s[`tpl${n}Subject`], body: s[`tpl${n}Body`] };
}

type LeadVars = LeadExtra & { businessName?: string | null; country?: string | null };

export function templateVars(lead: LeadVars, s: Settings): Record<string, string> {
  return {
    business: lead.businessName || "",
    contact: lead.contactName || "",
    city: lead.city || "",
    category: lead.category || "",
    country: lead.country || "",
    my_name: s.senderName || "",
    my_business: s.business || "",
  };
}

/** Fills the placeholders; leftover spaces before punctuation (from empty values) are tidied up. */
export function fillTemplate(text: string, vars: Record<string, string>) {
  return text
    .replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (_, k: string, def?: string) => (vars[k.toLowerCase()] || "").trim() || (def || "").trim())
    .split("\n")
    .map((l) => l.replace(/[ \t]+([,.!?;:])/g, "$1").replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .trim();
}
