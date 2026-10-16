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

/** The two template groups by name: "Bina website" / "Website hai". */
export const siteGroup = (has: boolean, t: T) => (has ? t("Website hai", "Has a website") : t("Bina website", "No website"));

/** A template's group in words (Settings field tplNFor). */
export function forText(f: TemplateFor, t: T) {
  if (f === "nosite") return t("Bina website (jinki apni website NAHI hai)", "No website (leads without a website of their own)");
  if (f === "site") return t("Website hai (jinki apni website HAI)", "Has a website (leads with a website of their own)");
  return t("Dono groups", "Both groups");
}

/** The tag as a short chip. */
export function forChip(f: TemplateFor, t: T) {
  if (f === "nosite") return t("Bina website", "No website");
  if (f === "site") return t("Website hai", "Has a website");
  return t("Dono", "Both");
}
