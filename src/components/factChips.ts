import type { Facts } from "@/lib/facts";

/**
 * The homepage facts exactly as the AI receives them (factsForPrompt in lib/facts.ts), in Hinglish,
 * one short line each, so the user can check every claim in a draft.
 */
export function factChips(f: Facts | null): string[] {
  if (!f) return ["Homepage abhi check nahi hua"];
  if (!f.hasWebsite) return ["Koi website nahi di gayi"];
  if (f.blockedByRobots) return ["Website hai, par check nahi ki (robots.txt ne mana kiya)"];
  if (f.error && !f.title) return [`Website load nahi hui (${f.error})`];
  const out: string[] = [];
  if (f.title) out.push(`Title: "${f.title}"`);
  out.push(f.description ? `Description: "${f.description}"` : "Meta description nahi hai");
  out.push(f.https ? "HTTPS hai" : "HTTPS nahi hai (secure nahi)");
  out.push(f.mobileViewport ? "Mobile viewport hai" : "Mobile viewport nahi hai");
  if (f.loadMs) out.push(`Homepage ${(f.loadMs / 1000).toFixed(1)} s mein load hua`);
  out.push(f.menuLink ? "Menu link hai" : "Menu link nahi mila");
  out.push(f.bookingLink ? "Booking link hai" : "Online booking link nahi mila");
  out.push(f.orderLink ? "Online order / shop link hai" : "Online order link nahi mila");
  if (f.footerYear) out.push(`Footer mein saal ${f.footerYear}`);
  return out;
}

/** Reads the stored facts JSON; bad JSON gives null instead of crashing the page. */
export function parseFacts(json?: string | null): Facts | null {
  if (!json) return null;
  try { return JSON.parse(json) as Facts; } catch { return null; }
}
