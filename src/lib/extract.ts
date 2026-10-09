import type { InRow } from "./importer";

const EMAIL_G = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL_G = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s,;)"']*)?/gi;
const PHONE_G = /(?:\+|00)?\d[\d\s().-]{7,}\d/g;

/** Best-effort extraction from unstructured text (PDF / TXT / paste) */
export function extractFromText(text: string): InRow[] {
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/);
  const rows: InRow[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const emails = [...new Set((block.match(EMAIL_G) || []).map((e) => e.toLowerCase()))];
    if (!emails.length) continue;
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const email of emails) {
      if (seen.has(email)) continue;
      seen.add(email);
      // narrow to the line(s) holding the email when a block contains several emails
      const scope = emails.length > 1 ? lines.filter((l) => l.toLowerCase().includes(email)).join(" ") : block;
      const urls = (scope.replace(EMAIL_G, " ").match(URL_G) || []).filter((u) => !/\.(png|jpe?g|pdf|gif)$/i.test(u));
      const phone = (scope.match(PHONE_G) || [])[0]?.trim();
      let name = emails.length > 1 ? scope.split(/[|,;:\t]| - /)[0] : lines[0];
      name = (name || "").replace(EMAIL_G, "").replace(URL_G, "").replace(PHONE_G, "").replace(/\s+/g, " ").trim();
      if (!name || name.length > 80) name = email.split("@")[1].split(".")[0];
      rows.push({ email, businessName: name, website: urls[0], phone });
    }
  }
  return rows;
}
