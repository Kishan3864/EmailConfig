import { detectLang } from "./lang";

const BANNED: [RegExp, string][] = [
  [/^\s*(re|fwd?|tr|aw|wg|rv)\s*:/i, "fake Re:/Fwd: subject"],
  [/\{\{|\}\}|\[[A-Z _]{3,}\]|<[a-z_ ]+>|\bXXX\b|lorem ipsum|\[(name|nom|company|business)\]/i, "leftover placeholder"],
  [/https?:\/\/|www\./i, "link in body (links are only allowed in the signature)"],
  [/\b(urgent|act now|limited time|last chance|hurry|only today|expires|dernière chance|offre limitée|dépêchez|aujourd'hui seulement|letzte chance|última oportunidad|ultima occasione)\b/i, "urgency"],
  [/\b(guarantee[d]?|garanti[e]?|100 ?%|free money|risk[- ]free|sans risque)\b/i, "hype claim"],
  [/!!|\?\?/, "repeated punctuation"],
  [/<img|<a |<html|<p>|<br/i, "HTML"],
  [/\b(as an ai|language model|en tant qu'ia)\b/i, "AI disclaimer"],
];
const CAPS = /\b[A-ZÀ-Ý]{4,}\b/g;
const OK_CAPS = new Set(["HTTPS", "HTTP", "HTML", "SEO", "URL", "WWW", "SMS", "PDF", "FAQ", "TVA", "SIRET", "RGPD", "GDPR", "CMS", "UX", "UI", "STOP", "OK", "CEO", "PME", "TPE", "SARL", "SAS", "SASU", "EURL", "GMBH", "LLC", "LTD"]);

/**
 * The rules every mail must pass (AI draft, template, the lead's own text, my edit). allowCaps: values that came in
 * through placeholders (business name, city…): capitals inside them are theirs, not my ALL CAPS, so they are not refused.
 */
export function validateDraft(subject: string, body: string, lang: string, businessName = "", allowCaps: string[] = []) {
  const errors: string[] = [];
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  if (words < 60 || words > 110) errors.push(`body has ${words} words (needs 60-110)`);
  if (!subject.trim() || subject.length > 90) errors.push("subject empty or too long");
  for (const [re, why] of BANNED) if (re.test(subject) || re.test(body)) errors.push(why);
  // only words already written in capitals in a lead value are theirs (whole words: "CHIRAZ" from "CAFÉ DE CHIRAZ");
  // a value that merely contains the letters ("free" in "Gluten-free bakery") does not excuse my own "FREE"
  const theirs = new Set(allowCaps.flatMap((v) => v.match(CAPS) || []));
  const bn = businessName.toUpperCase();
  const caps = `${subject} ${body}`.match(CAPS)?.filter((w) => !OK_CAPS.has(w) && !theirs.has(w) && !bn.includes(w));
  if (caps?.length) errors.push(`ALL CAPS words: ${caps.slice(0, 3).join(", ")}`);
  if (!body.includes("?")) errors.push("no question as call to action");
  const detected = detectLang(body);
  if (detected !== lang) errors.push(`language looks like "${detected}", expected "${lang}"`);
  return errors;
}
