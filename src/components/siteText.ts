import type { T } from "@/lib/i18n";
import type { TemplateFor } from "@/lib/templates";
import type { SiteStatus } from "@/lib/website";

// The same words on every page for "does this lead have a website?" and "whom is this template for?".

/** One line on why a lead counts as with / without a website (lib/website.ts). */
export function siteText(site: SiteStatus, t: T) {
  if (site.has) return t(`Lead ki apni website hai: ${site.domain}`, `The lead has its own website: ${site.domain}`);
  if (site.why === "profile") return t(`Sirf ${site.host} ka page hai, apni website nahi`, `Only a ${site.host} page, not a website of its own`);
  return t("Lead ki koi website nahi di gayi", "No website given for the lead");
}

/** Short group name: "Website wale" / "Bina website". */
export const siteGroup = (has: boolean, t: T) => (has ? t("Website wale", "Has a website") : t("Bina website", "No website"));

/** A template's "Kiske liye" tag in words. */
export function forText(f: TemplateFor, t: T) {
  if (f === "nosite") return t("Jinki website NAHI hai", "Leads without a website");
  if (f === "site") return t("Jinki website HAI", "Leads with a website");
  return t("Sabke liye", "Any lead");
}

/** The tag as a short chip. */
export function forChip(f: TemplateFor, t: T) {
  if (f === "nosite") return t("Bina website", "No website");
  if (f === "site") return t("Website wale", "Has a website");
  return t("Sab", "Any");
}
