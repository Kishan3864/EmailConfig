import type { Facts } from "@/lib/facts";
import { makeT, type Lang } from "@/lib/i18n";
import { knownFacts, type KnownKey } from "@/lib/leadinfo";

/** One thing the AI may say about a lead, with its label in the UI language. */
export type KnownItem = { key: KnownKey; label: string; value: string };

const KNOWN_LABEL: Record<KnownKey, { hi: string; en: string }> = {
  business: { hi: "Business", en: "Business" },
  contact: { hi: "Contact", en: "Contact" },
  category: { hi: "Business ka type", en: "Type of business" },
  city: { hi: "Shehar", en: "City" },
  country: { hi: "Desh", en: "Country" },
  about: { hi: "Kya karte hain", en: "What they do" },
  note: { hi: "Sach baat", en: "True fact" },
  siteTitle: { hi: "Unki website ka title", en: "Their website title" },
  siteDescription: { hi: "Unki website ka description", en: "Their website description" },
};

/**
 * Everything the AI is allowed to say about a lead: knownFacts() from lib/leadinfo.ts, the same list the AI gets,
 * labelled in the UI language, so every claim in a draft can be checked against it.
 */
export function knownItems(lead: Parameters<typeof knownFacts>[0], facts: Facts | null, lang: Lang = "hi"): KnownItem[] {
  const t = makeT(lang);
  return knownFacts(lead, facts).map(({ key, value }) => ({ key, value, label: t(KNOWN_LABEL[key].hi, KNOWN_LABEL[key].en) }));
}

/** Why the website's title / description are not in the known facts; null when at least one of them is. */
export function siteNote(website: string | null | undefined, f: Facts | null, lang: Lang = "hi"): string | null {
  const t = makeT(lang);
  if (f?.hasWebsite === false || (!f && !website?.trim())) return t("Koi website nahi di gayi", "No website listed");
  if (!f) return t("Website abhi check nahi hui", "Website not checked yet");
  if (f.blockedByRobots) return t("Website nahi padhi: uski robots.txt ne mana kiya", "Website not read: its robots.txt said no");
  if (f.title || f.description) return null;
  return f.error
    ? t(`Website load nahi hui: ${f.error}`, `Website did not load: ${f.error}`)
    : t("Website pe title ya description nahi mila", "No title or description found on the website");
}

/**
 * The full homepage check, one short line each, in the UI language (technical detail only: the AI now gets just
 * the title and description, see knownItems).
 */
export function factChips(f: Facts | null, lang: Lang = "hi"): string[] {
  const t = makeT(lang);
  if (!f) return [t("Homepage abhi check nahi hua", "Homepage not checked yet")];
  if (!f.hasWebsite) return [t("Koi website nahi di gayi", "No website listed")];
  if (f.blockedByRobots) return [t("Website hai, par check nahi ki (robots.txt ne mana kiya)", "Has a website, but it was not checked (robots.txt said no)")];
  if (f.error && !f.title) return [t(`Website load nahi hui (${f.error})`, `Website did not load (${f.error})`)];
  const out: string[] = [];
  if (f.title) out.push(`Title: "${f.title}"`);
  out.push(f.description ? `Description: "${f.description}"` : t("Meta description nahi hai", "No meta description"));
  out.push(f.https ? t("HTTPS hai", "Uses HTTPS") : t("HTTPS nahi hai (secure nahi)", "No HTTPS (not secure)"));
  out.push(f.mobileViewport ? t("Mobile viewport hai", "Has a mobile viewport") : t("Mobile viewport nahi hai", "No mobile viewport"));
  if (f.loadMs) out.push(t(`Homepage ${(f.loadMs / 1000).toFixed(1)} s mein load hua`, `Homepage loaded in ${(f.loadMs / 1000).toFixed(1)} s`));
  out.push(f.menuLink ? t("Menu link hai", "Has a menu link") : t("Menu link nahi mila", "No menu link found"));
  out.push(f.bookingLink ? t("Booking link hai", "Has a booking link") : t("Online booking link nahi mila", "No online booking link found"));
  out.push(f.orderLink ? t("Online order / shop link hai", "Has an online order / shop link") : t("Online order link nahi mila", "No online order link found"));
  if (f.footerYear) out.push(t(`Footer mein saal ${f.footerYear}`, `Footer year: ${f.footerYear}`));
  return out;
}

/** Reads the stored facts JSON; bad JSON gives null instead of crashing the page. */
export function parseFacts(json?: string | null): Facts | null {
  if (!json) return null;
  try { return JSON.parse(json) as Facts; } catch { return null; }
}
