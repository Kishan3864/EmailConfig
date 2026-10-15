import type { Facts } from "@/lib/facts";
import { makeT, type Lang } from "@/lib/i18n";

/**
 * The homepage facts exactly as the AI receives them (factsForPrompt in lib/facts.ts), one short line each,
 * in the UI language, so the user can check every claim in a draft.
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
