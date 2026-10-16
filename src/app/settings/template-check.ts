import type { T } from "@/lib/i18n";
import type { Settings } from "@/lib/settings";
import { detectLang } from "@/lib/lang";
import { fillTemplate, templateVars } from "@/lib/templates";
import { validateDraft } from "@/lib/validate";

// Pure helpers (no server code): used by the Settings template editor (client) and the Campaigns page (server).

/** The example lead the template previews and checks are filled with. */
export const EXAMPLE_LEAD = { businessName: "Bella Vista", contactName: "Laura", city: "Lyon", category: "restaurant", country: "France" };
/** The same lead with only a business name, so the {{x|text}} defaults show. */
const BARE_LEAD = { businessName: EXAMPLE_LEAD.businessName };
/** The example lead's own website, for templates written for leads with a website ({{website}} is filled with it). */
export const EXAMPLE_SITE = "bellavista-lyon.fr";

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*(?:\|[^}]*)?\}\}/gi;

/**
 * Fills a template the way the draft engine does and runs the same rules (lib/validate.ts) on it.
 * The language rule is checked against the text's own language, so it never fails here: `lang` tells which campaign language fits.
 * withSite: the example lead also has a website of its own (EXAMPLE_SITE); without it the lead has none, so {{website}} stays empty.
 */
export function tryTemplate(subject: string, body: string, me: Pick<Settings, "senderName" | "business">, full = true, withSite = false) {
  const lead = { ...(full ? EXAMPLE_LEAD : BARE_LEAD), website: withSite ? EXAMPLE_SITE : null };
  // templateVars reads only senderName and business from the settings
  const vars = templateVars(lead, me as Settings);
  const s = fillTemplate(subject, vars), b = fillTemplate(body, vars);
  const lang = detectLang(b);
  const words = b.split(/\s+/).filter(Boolean).length;
  const errors = validateDraft(s, b, lang, lead.businessName);
  // a misspelled placeholder ({{bussiness}}) is filled with nothing, without an error: point it out
  const unknown = [...new Set([...`${subject}\n${body}`.matchAll(PLACEHOLDER)].map((m) => m[1].toLowerCase()))].filter((k) => !Object.hasOwn(vars, k));
  return { subject: s, body: b, lang, words, errors, unknown, ok: !errors.length && !unknown.length };
}

/** One rule from validateDraft in the UI language (same wording as the draft errors elsewhere in the app). */
export function ruleText(e: string, t: T) {
  let m: RegExpMatchArray | null;
  if ((m = e.match(/^body has (\d+) words/))) return t(`Text mein ${m[1]} words hain, 60–110 chahiye`, `The text has ${m[1]} words, it needs 60–110`);
  if ((m = e.match(/^ALL CAPS words: (.+)$/))) return t(`CAPS wale shabd hatao: ${m[1]}`, `Remove the ALL CAPS words: ${m[1]}`);
  const known: Record<string, [string, string]> = {
    "subject empty or too long": ["Subject khaali hai ya 90 akshar se lamba hai", "The subject is empty or longer than 90 characters"],
    "fake Re:/Fwd: subject": ["Subject 'Re:' ya 'Fwd:' se shuru nahi ho sakta", "The subject cannot start with 'Re:' or 'Fwd:'"],
    "leftover placeholder": ["{{…}} ya [Name] jaisa placeholder bacha hai", "A placeholder like {{…}} or [Name] is left in the text"],
    "link in body (links are only allowed in the signature)": ["Text mein link nahi chalega (link sirf signature mein aata hai)", "No links in the text (links only go in the signature)"],
    urgency: ["'Urgent', 'last chance' jaise jaldbaazi wale shabd hatao", "Remove pushy words like 'urgent' or 'last chance'"],
    "hype claim": ["'Guarantee', '100%', 'risk-free' jaise daave hatao", "Remove claims like 'guarantee', '100%' or 'risk-free'"],
    "repeated punctuation": ["'!!' ya '??' mat likho", "Do not write '!!' or '??'"],
    HTML: ["HTML tags mat likho, sirf saada text", "No HTML tags, plain text only"],
    "AI disclaimer": ["'As an AI' jaisi line hatao", "Remove lines like 'As an AI'"],
    "no question as call to action": ["Aakhir mein ek sawaal (?) poochho", "End with a question (?)"],
  };
  return Object.hasOwn(known, e) ? t(...known[e]) : e;
}
