import type { Facts } from "./facts";
import type { LeadExtra } from "./fsdb";

/**
 * Everything the AI is allowed to know about a lead: the facts from the import file, plus the business's own website
 * title / description (only to understand what they do; the AI must never comment on the website itself).
 * The Approve and Contact pages show exactly this list, so every claim in a draft can be checked.
 */
export type KnownKey = "business" | "contact" | "category" | "city" | "country" | "about" | "note" | "siteTitle" | "siteDescription";
export type Known = { key: KnownKey; value: string };

type LeadIn = LeadExtra & { businessName?: string | null; country?: string | null };

export function knownFacts(lead: LeadIn, facts: Facts | null): Known[] {
  const out: Known[] = [];
  const add = (key: KnownKey, v?: string | null) => { const value = (v || "").replace(/\s+/g, " ").trim(); if (value) out.push({ key, value: value.slice(0, 400) }); };
  add("business", lead.businessName);
  add("contact", lead.contactName);
  add("category", lead.category);
  add("city", lead.city);
  add("country", lead.country);
  add("about", lead.about);
  add("note", lead.note);
  if (facts && facts.hasWebsite && !facts.blockedByRobots) {
    add("siteTitle", facts.title);
    add("siteDescription", facts.description);
  }
  return out;
}

/** True when we know what kind of business it is (otherwise the AI must keep the mail general). */
export const knowsWhatTheyDo = (k: Known[]) => k.some((x) => x.key === "category" || x.key === "about" || x.key === "siteDescription" || x.key === "siteTitle");
