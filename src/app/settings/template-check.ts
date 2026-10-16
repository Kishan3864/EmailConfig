import type { T } from "@/lib/i18n";
import type { Settings } from "@/lib/settings";
import { detectLang, LANGS } from "@/lib/lang";
import { capsAllowed, fillForLead, missingMark, templateVars } from "@/lib/templates";
import { validateDraft } from "@/lib/validate";

// Pure helpers (no server code): used by the Settings template editor (client) and the Campaigns page (server).

/** The example lead the template previews and checks are filled with (Google reviews, rating and an observation too). */
export const EXAMPLE_LEAD = {
  businessName: "Bella Vista", contactName: "Laura", city: "Lyon", category: "restaurant", country: "France",
  reviews: "331", rating: "4.6", observation: "the menu on your website is a photo that is hard to read on a phone",
};
/** The observation of the same lead in a "Bina website" preview: it has no website, so the problem is on another page. */
export const EXAMPLE_NOSITE_OBSERVATION = "your Facebook page does not show your opening hours";
/** The same lead with only a business name, so the {{x|text}} defaults show and {{observation}} is missing. */
const BARE_LEAD = { businessName: EXAMPLE_LEAD.businessName };
/** The example lead's own website, for templates written for leads with a website ({{website}} is filled with it). */
export const EXAMPLE_SITE = "bellavista-lyon.fr";

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*(?:\|[^}]*)?\}\}/gi;
const WORDS_RULE = /^body has \d+ words/;

/**
 * Fills a template the way the draft engine does (lib/drafts.ts draftForLead) and runs the same rules (lib/validate.ts).
 * withSite: the example lead also has a website of its own (EXAMPLE_SITE); without it the lead has none, so {{website}} stays empty.
 * setLang: the template's language from Settings ("" = read from its text). The rules check the text against it, so a
 * template whose text is in another language fails here like its drafts would; without it the check never fails.
 * missing: details a draft never fills with a stand-in ({{observation}}): such a draft waits as "Text chahiye", which is
 * not a rules failure. Like the worker, the other rules are then checked on the text around it, without the word count.
 * lang = the set language, else the text's own (textLang).
 */
export function tryTemplate(subject: string, body: string, me: Pick<Settings, "senderName" | "business">, full = true, withSite = false, setLang = "") {
  const lead = {
    ...(full ? { ...EXAMPLE_LEAD, observation: withSite ? EXAMPLE_LEAD.observation : EXAMPLE_NOSITE_OBSERVATION } : BARE_LEAD),
    website: withSite ? EXAMPLE_SITE : null,
  };
  // templateVars reads only senderName and business from the settings
  const vars = templateVars(lead, me as Settings);
  const f = fillForLead(subject, body, vars);
  // [OBSERVATION] is checked as a plain word, the way the worker does (else it reads as a leftover placeholder / ALL CAPS)
  const plain = (x: string) => f.missing.reduce((y, k) => y.split(missingMark(k)).join(k), x);
  const textLang = detectLang(plain(f.body));
  const lang = setLang || textLang;
  const words = plain(f.body).split(/\s+/).filter(Boolean).length;
  const errors = validateDraft(plain(f.subject), plain(f.body), lang, lead.businessName, capsAllowed(vars))
    .filter((e) => !(f.missing.length && WORDS_RULE.test(e)));
  // a misspelled placeholder ({{bussiness}}) is filled with nothing, without an error: point it out
  const unknown = [...new Set([...`${subject}\n${body}`.matchAll(PLACEHOLDER)].map((m) => m[1].toLowerCase()))].filter((k) => !Object.hasOwn(vars, k));
  return { subject: f.subject, body: f.body, lang, textLang, words, errors, unknown, missing: f.missing, ok: !errors.length && !unknown.length };
}

const langName = (l: string) => LANGS[l] || l.toUpperCase();

/** One rule from validateDraft in the UI language (same wording as the draft errors elsewhere in the app). */
export function ruleText(e: string, t: T) {
  let m: RegExpMatchArray | null;
  if ((m = e.match(/^body has (\d+) words/))) return t(`Text mein ${m[1]} words hain, 60–110 chahiye`, `The text has ${m[1]} words, it needs 60–110`);
  if ((m = e.match(/^ALL CAPS words: (.+)$/))) return t(
    `Apne text ke CAPS wale shabd hatao: ${m[1]} (placeholders se aaye capitals chalte hain)`,
    `Remove the ALL CAPS words from your own text: ${m[1]} (capitals that come from placeholders are fine)`,
  );
  if ((m = e.match(/^language looks like "([^"]+)", expected "([^"]+)"$/))) return t(
    `Text ${langName(m[1])} mein lagta hai, par Bhasha ${langName(m[2])} set hai: ${langName(m[2])} campaign mein iske drafts fail honge. Bhasha badlo ya text ${langName(m[2])} mein likho.`,
    `The text looks like ${langName(m[1])}, but the Language is set to ${langName(m[2])}: in a ${langName(m[2])} campaign its drafts fail. Change the Language or write the text in ${langName(m[2])}.`,
  );
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
