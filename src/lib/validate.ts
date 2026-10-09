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
const OK_CAPS = new Set(["HTTPS", "HTTP", "HTML", "SEO", "URL", "WWW", "SMS", "PDF", "FAQ", "TVA", "SIRET", "RGPD", "GDPR", "CMS", "UX", "UI", "STOP", "OK", "CEO", "PME", "TPE", "SARL", "SAS", "SASU", "EURL", "GMBH", "LLC", "LTD"]);

export function validateDraft(subject: string, body: string, lang: string, businessName = "") {
  const errors: string[] = [];
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  if (words < 60 || words > 110) errors.push(`body has ${words} words (needs 60-110)`);
  if (!subject.trim() || subject.length > 90) errors.push("subject empty or too long");
  for (const [re, why] of BANNED) if (re.test(subject) || re.test(body)) errors.push(why);
  const caps = `${subject} ${body}`.match(/\b[A-ZÀ-Ý]{4,}\b/g)?.filter((w) => !OK_CAPS.has(w) && !businessName.toUpperCase().includes(w));
  if (caps?.length) errors.push(`ALL CAPS words: ${caps.slice(0, 3).join(", ")}`);
  if (!body.includes("?")) errors.push("no question as call to action");
  const detected = detectLang(body);
  if (detected !== lang) errors.push(`language looks like "${detected}", expected "${lang}"`);
  return errors;
}
