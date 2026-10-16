"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Info } from "@/components/Info";
import { useT } from "@/components/lang";
import { friendlyError, useToast } from "@/components/toast";
import { Callout, EmptyState, Field, NextStep, PageHeader, Section, Steps, type StepState } from "@/components/ui";
import type { InRow } from "@/lib/importer"; // type only: nothing of the server module reaches the browser

// the rows go to /api/import/preview as they are, so they have exactly the importer's keys (GUESS and FIELD_INFO must cover every one)
type Row = Omit<InRow, "raw">;
type Key = keyof Row;
type HiEn = { hi: string; en: string };
const FIELDS: [Key, HiEn][] = [
  ["email", { hi: "Email *", en: "Email *" }], ["businessName", { hi: "Business ka naam", en: "Business name" }], ["contactName", { hi: "Contact ka naam", en: "Contact name" }],
  ["website", { hi: "Website", en: "Website" }], ["city", { hi: "Shehar", en: "City" }], ["country", { hi: "Desh", en: "Country" }],
  ["category", { hi: "Business ka type", en: "Type of business" }], ["about", { hi: "Business kya karta hai", en: "What they do" }], ["note", { hi: "Ek sach baat", en: "One true fact" }],
  ["reviews", { hi: "Google reviews", en: "Google reviews" }], ["rating", { hi: "Rating", en: "Rating" }],
  ["observation", { hi: "Observation (website ki ek problem)", en: "Observation (one problem on their website)" }],
  ["subject", { hi: "Apna subject", en: "Own subject" }], ["body", { hi: "Apna mail text", en: "Own mail text" }],
  ["phone", { hi: "Phone", en: "Phone" }], ["chain", { hi: "Chain hai?", en: "Chain flag" }],
];
const LABEL = Object.fromEntries(FIELDS) as Record<Key, HiEn>;

// Column guessing works on the header without accents, in lower case. [strong, weak]: every field first tries its strong
// pattern, and only then the weak one, so "Company" wins over "Name" or "Title".
const GUESS: Record<Key, RegExp[]> = {
  email: [/e-?mail|courriel|correo|mail/],
  businessName: [/business|company|entreprise|societe|firma|empresa|negocio|brand/, /name|nom|title/],
  contactName: [/contact|person|owner|first[ _-]?name|prenom|vorname|nombre|naam/],
  website: [/web|site|url|domain/],
  city: [/city|town|ville|stadt|ciudad|citta|shehar/],
  country: [/country|pays|land/],
  category: [/[ck]ategor|type|industry|niche|sector|secteur|activite|branche|rubro/],
  about: [/about|descri|services|products|what(?!s?app)|activity/],
  note: [/note|remark|comment|fact/],
  reviews: [/review|avis|bewertung|resena|recension/],
  // French "Note" alone is usually a remark: only "Note /5" or "Note sur 5" is a rating ("start" is not a star)
  rating: [/rating|\bstars?\b|etoiles?|score|^note ?(\/|sur) ?5$/],
  observation: [/observ|problem|issue|probleme|audit/],
  subject: [/^subject$|^objet$|^sujet$|subject|objet du mail/],
  body: [/^body$|mail[ _-]?(body|text)|message|corps|^texte?$/],
  phone: [/phone|(?:^|[^a-z])tel|mobile/],
  chain: [/chain|chaine|franchise/],
};
// headers a field must never take, even when its pattern matches ("Contact email" is not a name, "Business type" is not the business,
// "Mail subject" is not the address, "Website issue" is not the website, a "Messenger" link is not a mail text)
const NOT: Partial<Record<Key, RegExp>> = {
  email: /subject|objet|sujet|body|text|message|corps/,
  businessName: /mail|phone|web|site|url|type|[ck]ategor|descri|about|(?:last|full)[ _-]?name|surname|nachname|apellido|famille/,
  contactName: /mail|phone|(?:^|[^a-z])tel|web|site|url|contacted|business|company|entreprise|societe|firma|empresa|negocio|last[ _-]?name|surname|nachname|apellido|famille|message|subject/,
  website: /descri|title|about|observ|problem|issue|audit/,
  country: /landline/,
  reviews: /link|url|[ _-]id$|per[ _-]|tags/, // Google Maps exports: reviews_link, reviews_id, reviews_per_score
  body: /messenger|whatsapp|date/,
};
// guessing order: specific fields first, so "Contact name" goes to the contact and "Business type" to the type, not to the business name;
// observation, subject and body before website and contact ("Website issue", "Contact message"), rating before note ("Note /5")
const ORDER: Key[] = ["email", "observation", "subject", "body", "website", "contactName", "category", "about", "reviews", "rating", "note", "city", "country", "phone", "businessName", "chain"];
// fields that hold words: they never take a column of numbers or yes/no flags
const TEXT: Key[] = ["businessName", "contactName", "city", "country", "category", "about", "note", "observation", "subject", "body"];
// fields that hold a number (312, 4.8, 4,8/5): they never take a column without digits, like a column of written reviews
const NUM: Key[] = ["reviews", "rating"];
const plain = (h: unknown) => String(h ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Guesses the file column of each field. Every field takes the first column that matches and is not taken yet.
 * A column of email addresses only ever becomes the email; without an email header, the first column full of addresses is used.
 */
function guessColumns(headers: string[], rows: string[][]) {
  const vals = (i: number) => rows.slice(0, 50).map((r) => String(r[i] ?? "").trim()).filter(Boolean);
  const most = (i: number, re: RegExp) => { const v = vals(i); return v.length > 0 && v.filter((x) => re.test(x)).length * 2 > v.length; };
  const emails = (i: number) => most(i, /@/);
  const junk = (i: number) => most(i, /^(?:[\d\s.,:;\/+()%#*★-]+|yes|no|y|n|true|false|oui|non|ja|nein|si|x)$/i);
  const numbers = (i: number) => !vals(i).length || most(i, /\d/);
  const fits = (f: Key, i: number) =>
    f === "email" ? !vals(i).length || emails(i) : !emails(i) && !(TEXT.includes(f) && junk(i)) && !(NUM.includes(f) && !numbers(i));
  const m: Partial<Record<Key, number>> = {};
  const free = (i: number) => !Object.values(m).includes(i);
  for (const tier of [0, 1]) {
    for (const f of ORDER) {
      const re = GUESS[f][tier];
      if (!re || m[f] !== undefined) continue;
      const i = headers.findIndex((h, j) => free(j) && re.test(plain(h)) && !NOT[f]?.test(plain(h)) && fits(f, j));
      if (i >= 0) m[f] = i;
    }
  }
  if (m.email === undefined) {
    const i = headers.findIndex((_, j) => free(j) && emails(j));
    if (i >= 0) m.email = i;
  }
  return m;
}

// "CSV mein kya do": the columns of the sample CSV, in its order, with the first sample row as the example
const CSV_COLS: { col: string; req?: true; what: HiEn }[] = [
  { col: "email", req: true, what: { hi: "Jis address pe mail jayegi. Ek cell mein kai hon to app sabse achha khud chunta hai.", en: "The address the mail goes to. If a cell has several, the app picks the best one itself." } },
  { col: "business_name", what: { hi: "Business ka naam. Mail mein aur template ke {{business}} mein aata hai.", en: "The business name. Used in the mail and in the template's {{business}}." } },
  { col: "contact_name", what: { hi: "Owner ya manager ka pehla naam. Greeting mein (Hello Marco) aur {{contact}} mein.", en: "First name of the owner or manager. Used in the greeting (Hello Marco) and in {{contact}}." } },
  {
    col: "website",
    what: {
      hi: "Ek business ko ek hi mail jaye. Isse template ka group bhi tay hota hai: khaali, ya sirf Facebook / Instagram / Google Maps / booking page ya wixsite.com jaisa free page = 'Bina website', apna domain = 'Website hai'. AI isse sirf samajhta hai ki business kya karta hai, website pe kabhi comment nahi karta.",
      en: "Makes sure a business gets only one mail. It also picks the template group: empty, or only a Facebook / Instagram / Google Maps / booking page or a free page like wixsite.com = 'No website', a domain of their own = 'Has a website'. The AI only uses it to understand what they do and never comments on the website.",
    },
  },
  { col: "city", what: { hi: "Shehar. Mail mein aur {{city}} mein.", en: "The city. Used in the mail and in {{city}}." } },
  { col: "country", what: { hi: "Desh. Isse campaign ki bhasha aur time zone ka suggestion milta hai; {{country}} mein bhi.", en: "The country. Suggests the campaign language and time zone; also {{country}}." } },
  { col: "category", what: { hi: "Business ka type. Mail unke kaam ke hisaab se banti hai; {{category}} mein bhi.", en: "The type of business. Makes the mail fit their trade; also {{category}}." } },
  { col: "about", what: { hi: "Business kya karta hai, aapke shabdon mein: services ya products.", en: "What they do, in your words: services or products." } },
  { col: "note", what: { hi: "Ek sach baat jo aapne khud dekhi. AI ise ek baar, chhota sa use kar sakta hai.", en: "One true fact you checked yourself. The AI may mention it once, briefly." } },
  { col: "reviews", what: { hi: "Google pe kitne reviews hain, sirf number. Templates ke {{reviews}} mein aata hai; AI ise use nahi karta.", en: "How many Google reviews they have, just the number. Fills {{reviews}} in templates; the AI does not use it." } },
  { col: "rating", what: { hi: "Google rating, jaise 4.8. Templates ke {{rating}} mein aata hai; AI ise use nahi karta.", en: "The Google rating, like 4.8. Fills {{rating}} in templates; the AI does not use it." } },
  {
    col: "observation",
    what: {
      hi: "Unki website ki ek asli problem jo aapne khud dekhi, mail ki bhasha mein aur template ke sentence mein fit ho aise. {{observation}} mein aata hai. App ise kabhi khud nahi banata: template ko chahiye aur cell khaali hai, to draft 'Text chahiye' mein rukti hai jab tak aap wo hissa khud na likho.",
      en: "One real problem you saw on their website yourself, in the mail's language and worded to fit your template's sentence. Fills {{observation}}. The app never invents it: if the template needs it and the cell is empty, the draft waits as 'Text chahiye' (needs text) until you write that part yourself.",
    },
  },
  { col: "subject", what: { hi: "Is lead ke liye aapka apna subject. Sirf 'body' ke saath kaam karta hai.", en: "Your own subject for this lead. Works only together with 'body'." } },
  {
    col: "body",
    what: {
      hi: "Is lead ke liye aapka apna mail text. 'subject' aur 'body' dono hon to is lead ko template ya AI ki jagah bilkul yahi text jaata hai, wahi rules ke saath (60-110 shabd, sawaal (?), koi link nahi, campaign ki bhasha). Signature aur footer apne aap judte hain; approve phir bhi aap khud karoge.",
      en: "Your own mail text for this lead. With both 'subject' and 'body', this lead gets exactly this text instead of a template or the AI, under the same rules (60-110 words, a question (?), no links, the campaign's language). The signature and footer are added automatically; you still approve it yourself.",
    },
  },
  { col: "phone", what: { hi: "Sirf aapke record ke liye. Mail mein use nahi hota.", en: "Only for your records. It is not used in the mail." } },
];
// example rows of the sample CSV, in the order of CSV_COLS; .example addresses have no mail server, so an unchanged sample can never be mailed.
// The observation is in the mail's language (French leads, French text); the third row brings its own subject + body (60-110 words, a question).
const OWN_BODY = "Hello,\n\nI came across Greenleaf Yoga while looking for yoga studios in Manchester, and your hot yoga and beginner classes stood out to me.\n\nI help small studios make their website easier to use on a phone, with a clear class timetable and online booking, so new students can find a class and sign up in a minute.\n\nIf that sounds useful, I would be happy to send you two or three ideas for your studio, with no obligation at all.\n\nWould you be open to a short reply with your thoughts?";
const SAMPLE: string[][] = [
  ["contact@trattoria-roma.example", "Trattoria Roma", "Marco", "trattoria-roma.example", "Lyon", "France", "Italian restaurant", "Fresh pasta, pizza and takeaway; private room for events", "Family-run since 1985", "312", "4.8", "votre menu n'existe qu'en PDF, difficile à lire sur un téléphone", "", "", "+33 4 78 00 00 00"],
  ["info@cabinet-sourire.example", "Cabinet Dentaire Sourire", "Claire", "cabinet-sourire.example", "Bordeaux", "France", "Dental clinic", "General dentistry, implants and teeth whitening", "Open on Saturdays", "87", "4.6", "", "", "", "+33 5 56 00 00 00"],
  ["hello@greenleaf-yoga.example", "Greenleaf Yoga", "", "greenleaf-yoga.example", "Manchester", "United Kingdom", "Yoga studio", "Hot yoga and beginner classes, 7 days a week", "", "45", "4.9", "", "A question about Greenleaf Yoga", OWN_BODY, "+44 161 000 0000"],
];
/** The example shown next to a column in "CSV mein kya do": the first sample row that has one. */
const sampleOf = (i: number) => SAMPLE.find((r) => r[i])?.[i] || "";

/** Builds the sample CSV in the browser (UTF-8 with BOM, so Excel shows ★ and accents) and downloads it. */
function downloadSample() {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = "﻿" + [CSV_COLS.map((c) => c.col), ...SAMPLE].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "sample-leads.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// "Ek lead add karo": one address, sent through the same preview as a file
type OneKey = Exclude<Key, "phone" | "chain">;
const ONE_EMPTY: Record<OneKey, string> = {
  email: "", businessName: "", contactName: "", website: "", city: "", country: "", category: "", note: "", about: "",
  reviews: "", rating: "", observation: "", subject: "", body: "",
};
const ONE_PLACEHOLDER: Record<OneKey, HiEn> = {
  email: { hi: "contact@business.fr", en: "contact@business.com" },
  businessName: { hi: "Jaise Trattoria Roma", en: "E.g. Trattoria Roma" },
  contactName: { hi: "Jaise Marco", en: "E.g. Marco" },
  website: { hi: "Jaise trattoria-roma.fr", en: "E.g. trattoria-roma.com" },
  city: { hi: "Jaise Lyon", en: "E.g. Lyon" },
  country: { hi: "Jaise France", en: "E.g. France" },
  category: { hi: "Jaise Italian restaurant", en: "E.g. Italian restaurant" },
  note: { hi: "Jaise family-run since 1985", en: "E.g. family-run since 1985" },
  about: { hi: "Jaise fresh pasta, takeaway aur events ke liye catering", en: "E.g. fresh pasta, takeaway and catering for events" },
  reviews: { hi: "Jaise 312", en: "E.g. 312" },
  rating: { hi: "Jaise 4.8", en: "E.g. 4.8" },
  observation: { hi: "Jaise votre menu n'existe qu'en PDF (mail ki bhasha mein)", en: "E.g. votre menu n'existe qu'en PDF (in the mail's language)" },
  subject: { hi: "Khaali = template ya AI ka subject", en: "Empty = the template's or the AI's subject" },
  body: { hi: "Khaali chhodo to mail template ya AI se banegi", en: "Leave empty to have the mail made from a template or by the AI" },
};
// the lead's own mail: used only when both are given
const OWN: OneKey[] = ["subject", "body"];
// fields of several words get a text box (rows); the numbers get a number keyboard on phones
const AREA: Partial<Record<OneKey, number>> = { about: 2, observation: 2, body: 8 };

const FIELD_INFO: Record<Key, HiEn> = {
  email: {
    hi: "Wo column jismein email address hain. Ye zaroori hai. Ek cell mein kai emails hon to app khud sabse achha chunta hai (contact@, info@ pehle; jobs@, privacy@ jaise role address nahi).",
    en: "The column with the email addresses. This is required. If a cell has several emails, the app picks the best one itself (contact@, info@ first; never role addresses like jobs@, privacy@).",
  },
  businessName: {
    hi: "Business ka naam. AI mail likhte waqt isko use karta hai. Column na ho to '— koi nahi —' rehne do.",
    en: "The business name. The AI uses it when writing the mail. If there is no such column, leave it at '— none —'.",
  },
  contactName: {
    hi: "Kisi insaan ka pehla naam (owner ya manager), jaise Marco. Mail ki greeting mein use hota hai (Hello Marco) aur templates ke {{contact}} mein.\nPata na ho to khaali chhodo: tab greeting bina naam ke hoti hai, app naam ka andaza nahi lagata.",
    en: "A person's first name (owner or manager), like Marco. It is used in the greeting of the mail (Hello Marco) and in the templates' {{contact}}.\nIf you don't know it, leave it empty: the greeting then has no name, the app never guesses one.",
  },
  city: {
    hi: "Business ka shehar, jaise Lyon. AI ise mail mein use kar sakta hai, aur templates mein {{city}} isi se bharta hai.",
    en: "The business's city, like Lyon. The AI may use it in the mail, and {{city}} in the templates is filled from it.",
  },
  category: {
    hi: "Business ka type, jaise Italian restaurant ya dental clinic. Isse mail unke kaam ke hisaab se banti hai; templates mein {{category}}.\nYe aur 'Business kya karta hai' dono na hon (aur website se bhi pata na chale), to AI mail general rakhta hai, andaza nahi lagata.",
    en: "The type of business, like Italian restaurant or dental clinic. It makes the mail fit their trade; in templates it is {{category}}.\nIf neither this nor 'What they do' is known (and their website does not say), the AI keeps the mail general and never guesses.",
  },
  about: {
    hi: "Business kya karta hai, aapke shabdon mein: services ya products, jaise 'Fresh pasta, takeaway aur catering'.\nAI business ke baare mein sirf aapki di hui sach baatein (aur unki website ka apna title/description) use karta hai, andaza nahi lagata.",
    en: "What the business does, in your words: services or products, like 'Fresh pasta, takeaway and catering'.\nAbout the business, the AI uses only the true facts you give (and their website's own title and description); it never guesses.",
  },
  note: {
    hi: "Ek sach baat jo aapne khud dekhi ho, jaise 'Family-run since 1985'. AI ise mail mein ek baar, chhota sa use kar sakta hai.\nSirf pakki baat likho: andaza ya tareef nahi. Google reviews aur rating ke apne alag fields hain.",
    en: "One true fact you checked yourself, like 'Family-run since 1985'. The AI may mention it once, briefly.\nWrite only what is certain: no guesses, no flattery. Google reviews and rating have fields of their own.",
  },
  website: {
    hi: "Business ki website. Iske domain se pata chalta hai ki ek business ko ek hi mail jaye. Block list bhi isi se check hoti hai.\nIsse template ka group bhi tay hota hai: khaali, ya sirf Facebook / Instagram / Google Maps / booking page ya wixsite.com jaisa free page = 'Bina website'; apna domain = 'Website hai' (templates mein {{website}}).",
    en: "The business website. Its domain makes sure one business gets only one mail. The Block list is checked against it too.\nIt also picks the template group: empty, or only a Facebook / Instagram / Google Maps / booking page or a free page like wixsite.com = 'No website'; a domain of their own = 'Has a website' ({{website}} in templates).",
  },
  reviews: {
    hi: "Google pe kitne reviews hain, sirf number, jaise 312. Ye sirf templates ke {{reviews}} ke liye hai; AI ise use nahi karta.\nPata na ho to khaali chhodo: template mein {{reviews|...}} ka fallback text lagega.",
    en: "How many Google reviews they have, just the number, like 312. It is only for {{reviews}} in templates; the AI does not use it.\nIf you don't know it, leave it empty: the template's {{reviews|...}} fallback text is used.",
  },
  rating: {
    hi: "Google rating, jaise 4.8. Ye sirf templates ke {{rating}} ke liye hai; AI ise use nahi karta.\nPata na ho to khaali chhodo: template mein {{rating|...}} ka fallback text lagega.",
    en: "The Google rating, like 4.8. It is only for {{rating}} in templates; the AI does not use it.\nIf you don't know it, leave it empty: the template's {{rating|...}} fallback text is used.",
  },
  observation: {
    hi: "Unki website ki ek asli problem jo aapne khud dekhi, jaise 'votre menu n'existe qu'en PDF'. Mail ki bhasha mein likho, aise ki template ke sentence mein fit ho. Templates ke {{observation}} mein jaata hai.\nApp ise kabhi andaze se nahi bharta, fallback bhi nahi: template ko chahiye aur ye khaali hai, to draft 'Text chahiye' mein rukti hai jab tak aap wo hissa khud na likho.",
    en: "One real problem you saw on their website yourself, like 'votre menu n'existe qu'en PDF'. Write it in the mail's language, worded to fit your template's sentence. It goes into {{observation}} in templates.\nThe app never guesses it and uses no fallback: if the template needs it and it is empty, the draft waits as 'Text chahiye' (needs text) until you write that part yourself.",
  },
  subject: {
    hi: "Is lead ke liye aapka apna subject. Sirf 'Apna mail text' ke saath kaam karta hai: dono hon to is lead ko template ya AI ki jagah yahi mail jaati hai.",
    en: "Your own subject for this lead. It works only together with 'Own mail text': with both, this lead gets this mail instead of a template or the AI.",
  },
  body: {
    hi: "Is lead ke liye aapka apna mail text (signature aur footer apne aap judte hain). Sirf 'Apna subject' ke saath kaam karta hai.\nWahi rules lagte hain: 60-110 shabd, ek sawaal (?), koi link nahi, campaign ki bhasha. {{contact}} jaise placeholders bhi chalte hain. Approve phir bhi aap khud karoge.",
    en: "Your own mail text for this lead (the signature and footer are added automatically). It works only together with 'Own subject'.\nThe same rules apply: 60-110 words, a question (?), no links, the campaign's language. Placeholders like {{contact}} work too. You still approve it yourself.",
  },
  phone: {
    hi: "Sirf record ke liye save hota hai. Mail mein use nahi hota.",
    en: "Only saved for your records. It is not used in the mail.",
  },
  country: {
    hi: "Lead ka desh (jaise France ya FR). Isse campaign ki bhasha aur time zone ka suggestion milta hai, aur AI mail likhte waqt isko dhyan mein rakhta hai.",
    en: "The lead's country (like France or FR). It is used to suggest the campaign language and time zone, and the AI keeps it in mind when writing the mail.",
  },
  chain: {
    hi: "Agar koi column batata hai ki business chain ya franchise hai (1, yes, oui, x), to wo rows skip hongi. Chain businesses ko cold mail nahi bhejte.",
    en: "If a column says the business is a chain or franchise (1, yes, oui, x), those rows are skipped. Chain businesses are never sent cold mail.",
  },
};
// the single-lead form explains these two in its own words (FIELD_INFO talks about file columns); the others are the same
const ONE_INFO: Partial<Record<OneKey, HiEn>> = {
  email: {
    hi: "Jis address pe mail jayegi. Wahi checks chalte hain jo file mein: format, MX record, role address (jaise jobs@), Ledger aur Block list.",
    en: "The address the mail goes to. The same checks as for a file run: format, MX record, role address (like jobs@), Ledger and Block list.",
  },
  businessName: {
    hi: "Business ka naam. AI aur templates ({{business}}) isko mail mein use karte hain.",
    en: "The business name. The AI and the templates ({{business}}) use it in the mail.",
  },
};

const KNOWN_TYPES = /\.(csv|tsv|xlsx|xls|pdf|txt)$/i;
const fileSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const PHONE_ROWS = 20; // phones list only this many extracted contacts (no scroll box inside the page); all of them still go to the check

type ParseRes = { error?: string; kind?: "table" | "extracted"; headers?: string[]; rows?: unknown[] };
type Problem = { at: "parse" | "preview"; title: string; text?: string };

export default function ImportPage() {
  const router = useRouter();
  const toast = useToast();
  const { t, lang } = useT();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [listName, setListName] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [table, setTable] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [extracted, setExtracted] = useState<Row[] | null>(null);
  const [map, setMap] = useState<Partial<Record<Key, number>>>({});
  const [busy, setBusy] = useState<"" | "parse" | "preview" | "one">("");
  const [err, setErr] = useState<Problem | null>(null);
  const [drag, setDrag] = useState(false);
  const [reads, setReads] = useState(0); // bumps after every successful read, to bring step 2 into view
  const [csvOpen, setCsvOpen] = useState(false); // phones: the column list of "CSV mein kya do" is folded until opened
  const [one, setOne] = useState(ONE_EMPTY);
  const [oneErr, setOneErr] = useState<{ title: string; text?: string; at: "email" | "source" | "own" | "server" } | null>(null);
  const sourceRef = useRef<HTMLInputElement>(null);
  const oneEmailRef = useRef<HTMLInputElement>(null);
  const oneSourceRef = useRef<HTMLInputElement>(null);
  const autoName = useRef(false); // listName came from the file name (not typed), so a new file may replace it
  const readNo = useRef(0); // bumps on every read and every input change, so a read that finishes late is ignored

  useEffect(() => { document.title = t("Leads import · Outreach", "Import leads · Outreach"); }, [t]);
  useEffect(() => { if (reads) document.getElementById("step2")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [reads]);

  const fail = (at: Problem["at"], title: string, text?: string) => { setErr({ at, title, text }); toast.error(title, text); };
  // only one of the two own-mail columns is chosen: useless alone (the lead's own mail needs both)
  const ownHalf = (map.subject === undefined) !== (map.body === undefined);

  // A new file or changed text makes the last read stale: step 2 goes away until 'File / text padho' is pressed again,
  // so a preview can never be built from the previous file's rows.
  function resetRead() {
    readNo.current++;
    setTable(null); setExtracted(null); setMap({}); setErr(null);
  }
  function pick(f: File | null) {
    setFile(f);
    resetRead();
    if (autoName.current) { setListName(""); autoName.current = false; } // the old file's name; the next read fills in the new one
    if (f && !KNOWN_TYPES.test(f.name)) {
      toast.warning(
        t("Ye file type seedha support nahi hai", "This file type is not directly supported"),
        t("App ise text ki tarah padh ke emails dhoondhega. Behtar result ke liye CSV ya XLSX do.", "The app will read it as text and look for emails. For better results, use a CSV or XLSX."),
      );
    }
  }
  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pick(f);
  }

  async function parse() {
    if (!file && !text.trim()) {
      return fail("parse", t("Pehle file chuno ya text paste karo", "Choose a file or paste text first"), t("CSV, XLSX, PDF ya TXT file do, ya neeche text paste karo.", "Add a CSV, XLSX, PDF or TXT file, or paste text below."));
    }
    const no = ++readNo.current;
    setErr(null); setBusy("parse");
    const fd = new FormData();
    if (file) fd.append("file", file);
    fd.append("text", text);
    try {
      const r = await fetch("/api/import/parse", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as ParseRes;
      if (no !== readNo.current) return; // the file or text changed while this was being read
      // the route says "File padh nahi paye: <reason>" (English: "Could not read the file: <reason>"); the title already says that,
      // so show only the reason. Both prefixes are stripped, in case the language was switched while the file was being read.
      if (!r.ok || !j.kind) {
        return fail("parse", t("File padh nahi paye", "Could not read the file"),
          j.error?.replace(/^(?:File padh nahi paye|Could not read the file):\s*/i, "") || t(`Server ne error diya (${r.status})`, `The server returned an error (${r.status})`));
      }
      if (!listName && file) { setListName(file.name.replace(/\.\w+$/, "")); autoName.current = true; }
      if (j.kind === "table") {
        const headers = j.headers ?? [], rows = (j.rows ?? []) as string[][];
        setTable({ headers, rows }); setExtracted(null);
        const m = guessColumns(headers, rows);
        setMap(m);
        if (!rows.length) {
          toast.warning(t("File mein koi data row nahi mili", "No data rows found in the file"),
            t("Pehli line column ke naam maani jaati hai; uske neeche rows honi chahiye.", "The first line is read as the column names; the data rows must come below it."));
        } else {
          toast.success(t(`${plural(rows.length, "row", "rows")} mil gayi`, `Found ${plural(rows.length, "row", "rows")}`), m.email === undefined
            ? t("Email wala column khud nahi mila. Neeche 'Email *' mein chuno.", "The email column was not found automatically. Choose it under 'Email *' below.")
            : t("Neeche columns check karo, phir preview dekho.", "Check the columns below, then preview."));
        }
      } else {
        const rows = (j.rows ?? []) as Row[];
        setExtracted(rows); setTable(null);
        if (rows.length) {
          toast.success(t(`${plural(rows.length, "contact", "contacts")} ${rows.length === 1 ? "mila" : "mile"}`, `Found ${plural(rows.length, "contact", "contacts")}`),
            t("Neeche list check karo, phir preview dekho.", "Check the list below, then preview."));
        } else {
          toast.warning(t("Koi email nahi mila", "No emails found"), t("Is file ya text mein koi email address nahi dikha.", "No email address was found in this file or text."));
        }
      }
      setReads((n) => n + 1);
    } catch (e) {
      if (no === readNo.current) fail("parse", t("Server se jawab nahi aaya", "No response from the server"), friendlyError(e, t));
    } finally {
      setBusy("");
    }
  }

  async function preview() {
    let rows: Row[] = extracted || [];
    if (table) {
      if (map.email === undefined) {
        return fail("preview", t("Email wala column chuno", "Choose the email column"),
          t("'Email *' ke saamne wo column chuno jismein email address hain.", "Next to 'Email *', choose the column that holds the email addresses."));
      }
      if (ownHalf) {
        return fail("preview", t("Apna subject aur mail text: dono columns chuno", "Own subject and mail text: choose both columns"),
          t("Lead ka apna mail tabhi use hota hai jab dono hon. Ye columns nahi hain to dono ko '— koi nahi —' rakho.", "A lead's own mail is used only when both are there. If the file has no such columns, set both to '— none —'."));
      }
      rows = table.rows.map((r) => Object.fromEntries(FIELDS.filter(([f]) => map[f] !== undefined).map(([f]) => [f, r[map[f]!] ?? ""])) as Row);
    }
    if (!sourceNote.trim()) {
      sourceRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      sourceRef.current?.focus({ preventScroll: true });
      return fail("preview", t("Batao ye addresses kahan se mile", "Say where you found these addresses"),
        t("Ye mail ke footer mein dikhta hai. Upar 'List ki jaankari' mein bharo.", "It is shown in the mail footer. Fill it in under 'List details' above."));
    }
    if (!rows.length) return fail("preview", t("Check karne ke liye koi row nahi hai", "There are no rows to check"), t("Aisi file ya text do jismein email address hon.", "Add a file or text that contains email addresses."));
    setErr(null); setBusy("preview");
    try {
      const r = await fetch("/api/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listName, sourceNote, rows }) });
      const j = (await r.json().catch(() => ({}))) as { listId?: string; error?: string };
      if (!r.ok || !j.listId) {
        setBusy("");
        return fail("preview", t("Preview nahi ban paya", "Could not build the preview"), j.error || t(`Server ne error diya (${r.status})`, `The server returned an error (${r.status})`));
      }
      toast.success(t("Preview taiyaar hai", "The preview is ready"), t("Har row ka result dekho, phir import confirm karo.", "Check the result of each row, then confirm the import."));
      router.push(`/import/${j.listId}`); // stays busy until the preview page opens, so a second click cannot create a second list
    } catch (e) {
      setBusy("");
      fail("preview", t("Server se jawab nahi aaya", "No response from the server"), friendlyError(e, t));
    }
  }

  // "Ek lead add karo": the same /api/import/preview as a file, with one row; the preview page then shows its checks and the confirm
  async function addOne() {
    const failOne = (at: "email" | "source" | "own" | "server", title: string, text?: string) => { setOneErr({ at, title, text }); toast.error(title, text); };
    const row = Object.fromEntries(Object.entries(one).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)) as Row;
    if (!row.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      oneEmailRef.current?.focus();
      return failOne("email", row.email ? t("Ye email sahi nahi lagta", "This email does not look right") : t("Email daalo", "Enter the email address"),
        t("Jaise contact@business.fr. Sirf email zaroori hai, baaki jitna pata ho utna bharo.", "Like contact@business.com. Only the email is required; fill in whatever else you know."));
    }
    if (OWN.filter((k) => row[k]).length === 1) {
      return failOne("own", t("Apna subject aur mail text dono do", "Give both your own subject and mail text"),
        t("Lead ka apna mail tabhi use hota hai jab dono hon. Ya dono khaali chhodo: tab mail template ya AI se banegi.", "The lead's own mail is used only when both are there. Or leave both empty: the mail is then made from a template or by the AI."));
    }
    if (!sourceNote.trim()) {
      oneSourceRef.current?.focus();
      return failOne("source", t("Batao ye address kahan se mila", "Say where you found this address"),
        t("Ye mail ke footer mein dikhta hai, jaise 'Google Maps'.", "It is shown in the mail footer, like 'Google Maps'."));
    }
    setOneErr(null); setBusy("one");
    try {
      // a typed list name is used; a name taken from the chosen file is not (that file is a different list)
      const name = (!autoName.current && listName.trim()) || `Single: ${row.email}`;
      const r = await fetch("/api/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listName: name, sourceNote, rows: [row] }) });
      const j = (await r.json().catch(() => ({}))) as { listId?: string; error?: string };
      if (!r.ok || !j.listId) {
        setBusy("");
        return failOne("server", t("Preview nahi ban paya", "Could not build the preview"), j.error || t(`Server ne error diya (${r.status})`, `The server returned an error (${r.status})`));
      }
      toast.success(t("Preview taiyaar hai", "The preview is ready"), t("Result dekho, phir import confirm karo.", "Check the result, then confirm the import."));
      router.push(`/import/${j.listId}`); // stays busy until the preview page opens, so a second click cannot create a second list
    } catch (e) {
      setBusy("");
      failOne("server", t("Server se jawab nahi aaya", "No response from the server"), friendlyError(e, t));
    }
  }
  const oneSet = (f: OneKey) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setOne((o) => ({ ...o, [f]: e.target.value }));
  const ownWords = one.body.trim().split(/\s+/).filter(Boolean).length;
  const oneHint = (f: OneKey) => {
    if (f === "email" && oneErr?.at === "email") return <span className="text-red-600">{t("Sahi email address daalo", "Enter a valid email address")}</span>;
    if (OWN.includes(f) && oneErr?.at === "own" && !one[f].trim()) return <span className="text-red-600">{t("Dono chahiye: subject aur mail text", "Both are needed: subject and mail text")}</span>;
    // the same word rule as every mail (lib/validate.ts); the server checks all rules when the draft is made
    if (f === "body" && ownWords) {
      const ok = ownWords >= 60 && ownWords <= 110;
      return <span className={ok ? "text-emerald-700" : "text-amber-700"}>{t(`${ownWords} shabd (60-110 chahiye)`, `${ownWords} words (60-110 needed)`)}</span>;
    }
    return undefined;
  };
  const oneField = (f: OneKey, className = "") => {
    const bad = (f === "email" && oneErr?.at === "email") || (OWN.includes(f) && oneErr?.at === "own" && !one[f].trim());
    const cls = `input ${bad ? "border-red-400 focus:border-red-500 focus:ring-red-500/10" : ""}`;
    return (
      <Field key={f} className={className} label={LABEL[f][lang]} info={(ONE_INFO[f] || FIELD_INFO[f])[lang]} hint={oneHint(f)}>
        {AREA[f] ? (
          <textarea className={cls} rows={AREA[f]} value={one[f]} onChange={oneSet(f)} placeholder={ONE_PLACEHOLDER[f][lang]} />
        ) : (
          <input ref={f === "email" ? oneEmailRef : undefined} className={cls}
            type={f === "email" ? "email" : "text"} inputMode={f === "email" ? "email" : f === "reviews" ? "numeric" : f === "rating" ? "decimal" : undefined}
            autoComplete="off" spellCheck={f === "note" || f === "subject" ? undefined : false}
            value={one[f]} onChange={oneSet(f)} placeholder={ONE_PLACEHOLDER[f][lang]} />
        )}
      </Field>
    );
  };

  const parsed = !!table || !!extracted;
  const ready = (table?.rows.length || extracted?.length || 0) > 0; // something was read that can be checked
  // short labels on phones so all three steps fit on one line
  const steps = (short: boolean): { label: string; state: StepState }[] => [
    { label: short ? t("File do", "Add file") : t("File ya text do", "Add file or text"), state: ready ? "done" : "current" },
    {
      label: extracted ? (short ? t("Check karo", "Check") : t("Contacts check karo", "Check contacts")) : short ? t("Match karo", "Map") : t("Columns match karo", "Map columns"),
      state: ready ? "current" : "todo",
    },
    { label: short ? "Confirm" : "Preview & confirm", state: "todo" },
  ];
  const needSource = err?.at === "preview" && !sourceNote.trim();
  const needEmail = err?.at === "preview" && map.email === undefined;
  const mappedTo = (i: number) => FIELDS.find(([f]) => map[f] === i)?.[1][lang].replace(" *", "");
  // the source field, as the guidance texts point to it
  const whereFound = t(<b>Kahan se mile</b>, <b>where you found the addresses</b>);
  const readBtn = t(<b>File / text padho</b>, <b>Read file / text</b>);
  const sampleBtn = (className: string) => (
    <button type="button" className={`btn ${className}`} onClick={() => {
      downloadSample();
      toast.success(t("Sample CSV download ho gayi", "Sample CSV downloaded"),
        t("Example rows hata ke apni rows daalo, phir upar upload karo.", "Replace the example rows with your own, then upload the file above."));
    }}>
      <Icon name="download" size={14} />{t("Sample CSV download karo", "Download sample CSV")}
    </button>
  );

  const previewBar = (note: string) => (
    <>
      {err?.at === "preview" && <div className="mt-4"><Callout tone="danger" title={err.title}>{err.text}</Callout></div>}
      <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-1.5 text-xs text-slate-500"><Icon name="shield" size={14} className="mt-px text-slate-400" />{note}</p>
        <button type="button" className="btn-primary h-10 w-full sm:h-8 sm:w-auto" onClick={preview} disabled={!!busy}>
          <Icon name={busy === "preview" ? "loader" : "eye"} size={14} className={busy === "preview" ? "animate-spin" : ""} />
          {busy === "preview" ? t("Check ho raha hai (MX lookup)…", "Checking (MX lookups)…") : t("Check karke preview dekho", "Check & preview")}
        </button>
      </div>
    </>
  );

  return (
    <div>
      <PageHeader
        title={t("Leads import karo", "Import leads")}
        info={t(
          "Yahan se leads ki list app mein lao: CSV, XLSX, PDF, TXT file ya seedha paste kiya text. Sirf ek address ho to neeche 'Ek lead add karo' use karo.\nHar address check hota hai: MX record, role address (jaise jobs@, privacy@), chain, Ledger aur Block list.\nKuch bhi turant add nahi hota. Pehle preview dikhta hai; aap confirm karoge tabhi leads Contacts mein jayenge.\nFile mein kaun se columns do, ye neeche 'CSV mein kya do' mein hai.",
          "Bring a list of leads into the app from here: a CSV, XLSX, PDF or TXT file, or pasted text. For just one address, use 'Add a single lead' below.\nEvery address is checked: MX record, role address (like jobs@, privacy@), chain, Ledger and Block list.\nNothing is added right away. You see a preview first; leads go to Contacts only when you confirm.\nWhich columns to put in the file is shown below under 'What to put in the CSV'.",
        )}
        sub={t("File do (ya ek lead), columns match karo, phir preview dekh ke confirm karo.", "Add a file (or a single lead), map the columns, then check the preview and confirm.")}
      />

      <div className="space-y-4">
        <div>
          <div className="sm:hidden"><Steps steps={steps(true)} /></div>
          <div className="hidden sm:block"><Steps steps={steps(false)} /></div>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
            <Icon name="shield" size={14} className="mt-px shrink-0 text-slate-400" />
            {t(
              <span>Pehli baar import kar rahe ho? Pehle <Link href="/ledger" className="font-medium text-indigo-600 hover:text-indigo-700">Contacted Ledger</Link> mein purane contacts daalo (Sent folder import), taaki unhe dobara mail na jaye.</span>,
              <span>Importing for the first time? First add your past contacts to the <Link href="/ledger" className="font-medium text-indigo-600 hover:text-indigo-700">Contacted ledger</Link> (Sent folder import), so they never get mailed again.</span>,
            )}
          </p>
        </div>

        <Section title={t("List ki jaankari", "List details")} icon="file"
          info={t(
            "List ka naam sirf aapki pehchaan ke liye hai. 'Kahan se mile' zaroori hai, kyunki ye har mail ke footer mein sach-sach likha jata hai.",
            "The list name is only for you to recognise the list. 'Where did you find these addresses?' is required, because it is written truthfully in the footer of every mail.",
          )}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("List ka naam", "List name")}
              info={t(
                "Baad mein list pehchaanne ke liye, jaise 'Paris restaurants Oct'. Khaali chhodo to file ka naam (ya aaj ki date) use hoga.",
                "To recognise the list later, like 'Paris restaurants Oct'. Leave it empty to use the file name (or today's date).",
              )}
              hint={t("Khaali chhodo to file ka naam use hoga.", "Leave it empty to use the file name.")}>
              <input className="input" value={listName} onChange={(e) => { setListName(e.target.value); autoName.current = false; }} placeholder={t("Jaise Paris restaurants Oct", "E.g. Paris restaurants Oct")} />
            </Field>
            <Field label={t("Ye addresses kahan se mile? *", "Where did you find these addresses? *")}
              info={t(
                "Ye har mail ke footer mein likha jata hai, jaise: 'I found your address on Google Maps.' (mail ki bhasha mein).\nSach aur chhota likho: 'Google Maps', 'aapki website', 'PagesJaunes'.",
                "It is written in the footer of every mail, like: 'I found your address on Google Maps.' (in the mail's language).\nKeep it true and short: 'Google Maps', 'your website', 'PagesJaunes'.",
              )}
              hint={needSource
                ? <span className="text-red-600">{t("Ye bharna zaroori hai: mail ke footer mein dikhta hai.", "This is required: it is shown in the mail footer.")}</span>
                : t("Mail ke footer mein dikhega.", "Shown in the mail footer.")}>
              <input ref={sourceRef} className={`input ${needSource ? "border-red-400 focus:border-red-500 focus:ring-red-500/10" : ""}`} value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} placeholder={t("Jaise Google Maps", "E.g. Google Maps")} />
            </Field>
          </div>
        </Section>

        <Section title={t("File upload karo ya text paste karo", "Upload a file or paste text")} icon="upload"
          info={t(
            "CSV ya XLSX mein pehli line column ke naam honi chahiye; agle step mein unhe match karoge. Kaun se columns dene hain, wo neeche 'CSV mein kya do' mein hai.\nPDF, TXT ya paste kiye text se app khud emails, naam, website aur phone dhoondhta hai (andaze se).\nFile aur text dono do to sirf file padhi jayegi.",
            "In a CSV or XLSX the first line must hold the column names; you map them in the next step. Which columns to give is shown below under 'What to put in the CSV'.\nFrom a PDF, TXT or pasted text the app finds emails, names, websites and phones itself (best effort).\nIf you give both a file and text, only the file is read.",
          )}
          sub={t(
            <>Kaun se columns dein: <a href="#csv-guide" onClick={() => setCsvOpen(true)} className="link">CSV mein kya do</a>. Sirf ek address hai? <a href="#one-lead" className="link">Ek lead add karo</a>.</>,
            <>Which columns to give: <a href="#csv-guide" onClick={() => setCsvOpen(true)} className="link">What to put in the CSV</a>. Only one address? <a href="#one-lead" className="link">Add a single lead</a>.</>,
          )}>
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false); }}
            onDrop={onDrop}
            className={`group flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed px-4 text-center transition focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-500/10 ${file ? "gap-2.5 py-3.5" : "flex-col py-8 sm:py-10"} ${drag ? "border-indigo-400 bg-indigo-50/70" : "border-slate-200 bg-slate-50/60 hover:border-indigo-300 hover:bg-indigo-50/30"}`}>
            <input type="file" accept=".csv,.tsv,.xlsx,.xls,.pdf,.txt" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
            <span className={`grid place-items-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 transition group-hover:text-indigo-600 ${file ? "h-8 w-8" : "h-11 w-11"} ${drag ? "text-indigo-600" : "text-slate-500"}`}>
              <Icon name="upload" size={file ? 15 : 19} />
            </span>
            {file ? (
              <span className="text-sm font-medium text-slate-700">
                <span className="text-indigo-600 sm:hidden">{t("Tap karke file badlo", "Tap to change the file")}</span>
                <span className="hidden sm:inline">
                  {drag
                    ? t("Yahan chhod do", "Drop it here")
                    : t(<>Doosri file yahan chhodo ya <span className="text-indigo-600">click karke badlo</span></>, <>Drop another file here or <span className="text-indigo-600">click to change it</span></>)}
                </span>
              </span>
            ) : (
              <>
                <span className="mt-3 text-sm font-medium text-slate-800">
                  <span className="text-indigo-600 sm:hidden">{t("Tap karke file chuno", "Tap to choose a file")}</span>
                  <span className="hidden sm:inline">
                    {drag
                      ? t("Yahan chhod do", "Drop it here")
                      : t(<>File yahan chhodo ya <span className="text-indigo-600">click karke chuno</span></>, <>Drop a file here or <span className="text-indigo-600">click to choose one</span></>)}
                  </span>
                </span>
                <span className="mt-1 text-xs text-slate-400">{t("CSV, TSV, XLSX, XLS, PDF ya TXT", "CSV, TSV, XLSX, XLS, PDF or TXT")}</span>
              </>
            )}
          </label>

          {file && (
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5 pl-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-indigo-50 text-indigo-600"><Icon name="file" size={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">{file.name}</div>
                <div className="text-xs text-slate-500">{fileSize(file.size)} · {t("padhne ke liye taiyaar", "ready to read")}</div>
              </div>
              <button type="button" onClick={() => pick(null)} className="btn-ghost btn-icon btn-sm" aria-label={t("File hatao", "Remove file")} title={t("File hatao", "Remove file")}><Icon name="x" size={14} /></button>
            </div>
          )}

          <div className="my-4 flex items-center gap-3 text-xs font-medium text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />{t("ya text paste karo", "or paste text")}<span className="h-px flex-1 bg-slate-200" />
          </div>
          <textarea className="input" rows={5} value={text} onChange={(e) => { setText(e.target.value); if (!file) resetRead(); }} aria-label={t("Text paste karo", "Paste text")}
            placeholder={t("Kuch bhi paste karo jismein emails, business ke naam, website ya phone hon", "Paste anything that contains emails, business names, websites or phones")} />
          {file && text.trim() && (
            <p className="hint">{t("File chuni hui hai, isliye ye text use nahi hoga. Text chahiye to upar se file hata do.", "A file is chosen, so this text will not be used. To use the text, remove the file above.")}</p>
          )}

          {err?.at === "parse" && <div className="mt-4"><Callout tone="danger" title={err.title}>{err.text}</Callout></div>}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="button" className="btn-primary h-10 w-full sm:h-8 sm:w-auto" onClick={parse} disabled={!!busy}>
              <Icon name={busy === "parse" ? "loader" : "file-up"} size={14} className={busy === "parse" ? "animate-spin" : ""} />
              {busy === "parse" ? t("Padh raha hai…", "Reading…") : t("File / text padho", "Read file / text")}
            </button>
            <span className="text-center text-xs text-slate-400 sm:text-left">{t("Abhi kuch save nahi hota, sirf padha jata hai.", "Nothing is saved yet, it is only read.")}</span>
          </div>
        </Section>

        {table && (
          <Section id="step2" className="scroll-mt-20" icon="sliders" title={t(`Columns match karo (${plural(table.rows.length, "row", "rows")})`, `Map columns (${plural(table.rows.length, "row", "rows")})`)}
            info={t(
              "Batao file ka kaunsa column kya hai. App ne column ke naam dekh ke khud andaza lagaya hai; galat ho to badal do.\nSirf Email zaroori hai. Baaki column na hon to '— koi nahi —' rehne do.\nBusiness ka type, 'kya karta hai' aur 'ek sach baat' wale columns hon to zaroor match karo: inse AI ki mail sabse specific banti hai.\nGoogle reviews, rating aur observation sirf templates ke liye hain ({{reviews}} {{rating}} {{observation}}). 'Apna subject' + 'Apna mail text' dono hon to us lead ko template ya AI ki jagah wahi mail jaati hai.",
              "Tell the app what each column of the file is. It has guessed from the column names; change anything that is wrong.\nOnly Email is required. If the other columns are missing, leave them at '— none —'.\nIf the file has columns for the type of business, what they do or a true fact, do map them: they make the AI's mail the most specific.\nGoogle reviews, rating and observation are only for templates ({{reviews}} {{rating}} {{observation}}). With both 'Own subject' and 'Own mail text', that lead gets this mail instead of a template or the AI.",
            )}
            sub={t("Har field ke saamne file ka sahi column chuno.", "For each field, choose the matching column of the file.")}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map(([f, label]) => (
                <Field key={f} label={label[lang]} info={FIELD_INFO[f][lang]}
                  hint={f === "email" && map.email === undefined
                    ? <span className="text-red-600">{t("Ye zaroori hai", "This is required")}</span>
                    : (f === "subject" || f === "body") && ownHalf
                      ? <span className={err?.at === "preview" ? "text-red-600" : "text-amber-700"}>{t("Dono chahiye: 'Apna subject' aur 'Apna mail text'", "Both are needed: 'Own subject' and 'Own mail text'")}</span>
                      : undefined}>
                  <select className={`input ${(f === "email" && needEmail) || (map[f] === undefined && ownHalf && err?.at === "preview" && (f === "subject" || f === "body")) ? "border-red-400" : ""}`}
                    value={map[f] ?? ""} onChange={(e) => setMap({ ...map, [f]: e.target.value === "" ? undefined : Number(e.target.value) })}>
                    <option value="">{t("— koi nahi —", "— none —")}</option>
                    {table.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </Field>
              ))}
            </div>

            <div className="mb-2 mt-6 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              {t("Pehli 5 rows ka preview", "Preview of the first 5 rows")}
              <Info title={t("Pehli 5 rows", "First 5 rows")} size={13}
                text={t(
                  "File ki shuruaat ki 5 rows, taaki column pehchaanna aasaan ho. Jo column kisi field se juda hai, uska header neela dikhta hai.",
                  "The first 5 rows of the file, so the columns are easy to recognise. A column linked to a field has a blue header.",
                )} />
            </div>
            {table.rows.length ? (
              <div className="card-flush !shadow-none">
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        {table.headers.map((h, i) => {
                          const to = mappedTo(i);
                          return (
                            <th key={i} className={to ? "!bg-indigo-50 !text-indigo-700" : ""}>
                              {h || `Column ${i + 1}`}
                              {to && <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-indigo-600 px-1 py-px normal-case tracking-normal text-white"><Icon name="arrow-right" size={10} strokeWidth={2.4} />{to}</span>}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.slice(0, 5).map((r, i) => (
                        <tr key={i}>{r.map((c, j) => <td key={j} className={mappedTo(j) ? "bg-indigo-50/30" : ""}><span className="block max-w-[200px] truncate" title={c}>{c}</span></td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <Callout tone="warn" title={t("File mein koi data row nahi mili", "No data rows found in the file")}>
                {t("Pehli line column ke naam maani jaati hai; uske neeche rows honi chahiye. Doosri file try karo.", "The first line is read as the column names; the data rows must come below it. Try another file.")}
              </Callout>
            )}
            {table.rows.length > 0 && previewBar(t(
              "Har address ka MX record, Ledger aur Block list check hoga. Badi file mein 1-2 minute lag sakte hain.",
              "Every address is checked for an MX record, the Ledger and the Block list. A big file can take 1-2 minutes.",
            ))}
          </Section>
        )}

        {extracted && (
          <Section id="step2" className="scroll-mt-20" icon="list"
            title={extracted.length
              ? t(`${plural(extracted.length, "contact", "contacts")} ${extracted.length === 1 ? "mila" : "mile"} (andaze se)`, `Found ${plural(extracted.length, "contact", "contacts")} (best effort)`)
              : t("Koi contact nahi mila", "No contacts found")}
            info={t(
              "PDF, TXT ya text se app ne emails dhoondhe, aur unke aas-paas se naam, website aur phone andaze se uthaya. Galti ho sakti hai; agle page pe har row ka result dikhega.",
              "The app found the emails in the PDF, TXT or text and guessed the name, website and phone from the text around them. It can make mistakes; the next page shows the result of every row.",
            )}
            sub={!extracted.length ? undefined : extracted.length > 200
              ? t("Yahan pehle 200 dikh rahe hain; check mein saare jayenge.", "Showing the first 200 here; all of them go to the check.")
              : t("Text se nikale gaye contacts. Ek nazar daal lo.", "Contacts taken from the text. Give them a quick look.")}>
            {extracted.length ? (
              <div className="card-flush !shadow-none">
                {/* scroll box only on wider screens; on phones the cards follow the page scroll */}
                <div className="md:max-h-96 md:overflow-auto">
                  <table className="tbl tbl-stack">
                    <thead className="sticky top-0 z-[1] bg-slate-50"><tr><th>Email</th><th>Business</th><th>Website</th><th>Phone</th></tr></thead>
                    <tbody>
                      {extracted.slice(0, 200).map((r, i) => (
                        <tr key={i} className={i >= PHONE_ROWS ? "max-md:!hidden" : undefined}>
                          <td className="font-medium text-slate-900 max-md:[overflow-wrap:anywhere]">{r.email}</td>
                          <td data-label="Business">{r.businessName}</td>
                          <td data-label="Website">{r.website && <span className="block min-w-0 max-w-[220px] truncate" title={r.website}>{r.website}</span>}</td>
                          <td data-label="Phone" className="whitespace-nowrap">{r.phone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {extracted.length > PHONE_ROWS && (
                  <p className="px-4 py-2.5 text-xs text-slate-500 md:hidden">
                    {t(`Yahan pehle ${PHONE_ROWS} dikh rahe hain; check mein saare ${extracted.length} jayenge.`, `Showing the first ${PHONE_ROWS} here; all ${extracted.length} go to the check.`)}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200">
                <EmptyState icon="search" title={t("Koi email nahi mila", "No emails found")}
                  text={t(
                    "Is file ya text mein koi email address nahi dikha. Doosri file chuno ya aisa text paste karo jismein emails hon.",
                    "No email address was found in this file or text. Choose another file or paste text that contains emails.",
                  )} />
              </div>
            )}
            {extracted.length > 0 && previewBar(t(
              "Har address ka MX record, Ledger aur Block list check hoga. Abhi kuch add nahi hoga.",
              "Every address is checked for an MX record, the Ledger and the Block list. Nothing is added yet.",
            ))}
          </Section>
        )}

        {!parsed ? (
          err?.at === "parse" && (file || text.trim()) ? (
            <NextStep tone="amber" text={t(
              <>Upar wali problem dekho, phir {readBtn} dobara dabao. Na chale to doosri file do (CSV sabse aasaan hai).</>,
              <>Check the problem above, then press {readBtn} again. If it still fails, try another file (CSV is the easiest).</>,
            )} />
          ) : (
            <NextStep text={!file && !text.trim()
              ? (sourceNote.trim()
                ? t(<>File chuno ya text paste karo, phir {readBtn} dabao.</>, <>Choose a file or paste text, then press {readBtn}.</>)
                : t(<>Upar {whereFound} bharo, file chuno ya text paste karo, phir {readBtn} dabao.</>, <>Fill in {whereFound} above, choose a file or paste text, then press {readBtn}.</>))
              : (sourceNote.trim()
                ? t(<>Ab {readBtn} dabao. Uske baad check karke preview dekho.</>, <>Now press {readBtn}. After that, check and preview the list.</>)
                : t(<>Ab {readBtn} dabao. Upar {whereFound} bhi bhar do, preview ke liye ye zaroori hai.</>, <>Now press {readBtn}. Also fill in {whereFound} above; the preview needs it.</>))} />
          )
        ) : !ready ? (
          <NextStep tone="amber" text={t(
            <>Is file ya text mein kaam ki koi row nahi mili. Doosri file chuno ya text paste karo, phir {readBtn} dabao.</>,
            <>No usable rows were found in this file or text. Choose another file or paste text, then press {readBtn}.</>,
          )} />
        ) : (
          <NextStep text={table
            ? t(<>Columns sahi lag rahe hain? <b>Check karke preview dekho</b> dabao. Agle page pe har address ka result dikhega, aur wahin se import confirm hoga.</>,
              <>Do the columns look right? Press <b>Check & preview</b>. The next page shows the result for every address, and you confirm the import there.</>)
            : t(<>List theek lag rahi hai? <b>Check karke preview dekho</b> dabao. Agle page pe har address ka result dikhega, aur wahin se import confirm hoga.</>,
              <>Does the list look fine? Press <b>Check & preview</b>. The next page shows the result for every address, and you confirm the import there.</>)} />
        )}

        <Section id="csv-guide" icon="bulb" title={t("CSV mein kya do", "What to put in the CSV")}
          info={t(
            "File mein kaun se columns daalo, aur app unka kya karta hai. Pehli line mein column ke naam; har row ek business.\nColumn ke naam kisi bhi bhasha mein chalte hain, agle step mein match ho jaate hain. Sirf email zaroori hai.\nJo baat pakki pata na ho, wo cell khaali chhodo: AI har cell ko sach maanta hai, to galat baat seedhe mail mein jayegi.",
            "Which columns to put in the file, and what the app does with them. Column names go in the first line; every row is one business.\nColumn names can be in any language; you match them in the next step. Only the email is required.\nIf you are not sure about something, leave that cell empty: the AI takes every cell as true, so a wrong value would go straight into the mail.",
          )}
          sub={t("Sirf email zaroori hai. Baaki jitna sach pata ho, utna do.", "Only the email is required. Add whatever else you know for sure.")}
          // phones: the button gets a row of its own in the card; next to the title it squeezes it to one word per line
          actions={<div className="max-sm:hidden">{sampleBtn("")}</div>}>
          <Callout tone="info" title={t("Sabse achhi mail ke liye", "For the best mails")}>
            {t(
              <><b>category</b> + <b>about</b> + <b>note</b> se AI ki mail sabse specific banti hai. AI sirf yahi sach baatein use karta hai aur kabhi website pe comment nahi karta. Templates ke liye <b>reviews</b>, <b>rating</b> aur <b>observation</b> do; <b>observation</b> sirf wahi likho jo aapne khud dekha.</>,
              <><b>category</b> + <b>about</b> + <b>note</b> make the AI&apos;s mail the most specific. The AI uses only these true facts and never comments on the website. For templates, give <b>reviews</b>, <b>rating</b> and <b>observation</b>; write an <b>observation</b> only for what you saw yourself.</>,
            )}
          </Callout>
          <div className="sm:hidden">{sampleBtn("mt-3 h-10 w-full")}</div>
          <button type="button" className="btn mt-2 w-full sm:mt-3 md:hidden" onClick={() => setCsvOpen(!csvOpen)} aria-expanded={csvOpen} aria-controls="csv-cols">
            <Icon name="chevron-down" size={14} className={`transition ${csvOpen ? "rotate-180" : ""}`} />
            {csvOpen ? t("Columns chhupao", "Hide the columns") : t(`Saare ${CSV_COLS.length} columns dekho`, `See all ${CSV_COLS.length} columns`)}
          </button>
          <div id="csv-cols" className={`mt-3 ${csvOpen ? "" : "max-md:hidden"}`}>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="hidden grid-cols-[136px_minmax(0,1fr)_minmax(0,250px)] gap-4 border-b border-slate-200 bg-slate-50/70 px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
                <span>Column</span><span>{t("Kis kaam aata hai", "What it is for")}</span><span>Example</span>
              </div>
              <ul className="divide-y divide-slate-100">
                {CSV_COLS.map((c, i) => (
                  <li key={c.col} className="grid gap-x-4 gap-y-0.5 px-3 py-2 md:grid-cols-[136px_minmax(0,1fr)_minmax(0,250px)] md:items-baseline">
                    <span className="flex items-center gap-1.5">
                      <code className="font-mono text-xs font-semibold text-slate-900">{c.col}</code>
                      {c.req && <span className="rounded bg-red-50 px-1 text-2xs font-semibold text-red-600">{t("zaroori", "required")}</span>}
                    </span>
                    <span className="text-xs leading-relaxed text-slate-600">{c.what[lang]}</span>
                    <span className="truncate text-xs text-slate-400" title={sampleOf(i)}><span className="md:hidden">{t("Jaise", "E.g.")}: </span>{sampleOf(i)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="hint">
              {t(
                "Column ke naam kisi bhi bhasha mein chalenge, agle step mein match kar sakte ho. Sample ki rows sirf example hain (.example address): unhe hata ke apni rows daalo.",
                "Column names can be in any language; you match them in the next step. The sample rows are only examples (.example addresses): replace them with your own.",
              )}
            </p>
          </div>
        </Section>

        <Section id="one-lead" icon="user" title={t("Ek lead add karo", "Add a single lead")}
          info={t(
            "Sirf ek address hai? Yahan bharo. Ye file jaisa hi chalta hai: wahi checks (MX record, role address, Ledger, Block list), phir preview page pe aap confirm karte ho.\nJitna sach pata ho utna bharo, baaki khaali chhodo. AI business ke baare mein sirf yahi baatein (aur unki website ka apna title/description) use karta hai.\nGoogle reviews, rating aur observation templates ke liye hain. Chaho to neeche is lead ke liye apna poora mail text bhi de sakte ho.",
            "Only one address? Fill it in here. It works just like a file: the same checks (MX record, role address, Ledger, Block list), then you confirm on the preview page.\nFill in what you know for sure and leave the rest empty. About the business, the AI uses only these facts (and their website's own title and description).\nGoogle reviews, rating and observation are for templates. If you like, you can also give your own full mail text for this lead below.",
          )}
          sub={t("Wahi checks aur preview jo file ke liye, bas file ke bina.", "The same checks and preview as for a file, just without one.")}>
          <form noValidate onSubmit={(e) => { e.preventDefault(); addOne(); }}>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {oneField("email")}
              <Field label={t("Ye address kahan se mila? *", "Where did you find this address? *")}
                info={t(
                  "Upar 'List ki jaankari' wala hi field hai, dono jagah ek hi value rehti hai.\nYe mail ke footer mein sach-sach likha jata hai, jaise 'Google Maps' ya 'aapki website'.",
                  "The same field as in 'List details' above; both places keep one value.\nIt is written truthfully in the mail footer, like 'Google Maps' or 'your website'.",
                )}
                hint={oneErr?.at === "source" && !sourceNote.trim()
                  ? <span className="text-red-600">{t("Ye bharna zaroori hai: mail ke footer mein dikhta hai.", "This is required: it is shown in the mail footer.")}</span>
                  : t("Mail ke footer mein dikhega.", "Shown in the mail footer.")}>
                <input ref={oneSourceRef} className={`input ${oneErr?.at === "source" && !sourceNote.trim() ? "border-red-400 focus:border-red-500 focus:ring-red-500/10" : ""}`}
                  value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} placeholder={t("Jaise Google Maps", "E.g. Google Maps")} />
              </Field>
              {oneField("businessName")}
              {oneField("contactName")}
              {oneField("website")}
              {oneField("city")}
              {oneField("country")}
              {oneField("category")}
              {oneField("note", "md:col-span-2 lg:col-span-1")}
              {oneField("reviews")}
              {oneField("rating")}
              {oneField("observation", "md:col-span-2 lg:col-span-1")}
              {oneField("about", "md:col-span-2 lg:col-span-3")}
            </div>
            {/* the lead's own mail: folded, most leads get a template or the AI */}
            <details className="group mt-4 border-t border-slate-100 pt-4">
              <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 text-sm font-medium text-slate-700 transition hover:text-indigo-700">
                <Icon name="chevron-right" size={14} className="shrink-0 text-slate-400 transition group-open:rotate-90" />
                {t("Apna mail text do (optional)", "Give your own mail text (optional)")}
              </summary>
              <p className="hint">
                {t(
                  "Subject aur text dono do to is lead ko template ya AI ki jagah bilkul yahi mail jaati hai, wahi rules ke saath. Approve phir bhi aap khud karoge.",
                  "Give both a subject and a text and this lead gets exactly this mail instead of a template or the AI, under the same rules. You still approve it yourself.",
                )}
              </p>
              <div className="mt-3 grid gap-3">
                {oneField("subject")}
                {oneField("body")}
              </div>
            </details>
            {oneErr && <div className="mt-4"><Callout tone="danger" title={oneErr.title}>{oneErr.text}</Callout></div>}
            <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-1.5 text-xs text-slate-500">
                <Icon name="shield" size={14} className="mt-px text-slate-400" />
                {t("Abhi kuch add nahi hoga: pehle checks aur preview, phir aap confirm karoge.", "Nothing is added yet: first the checks and the preview, then you confirm.")}
              </p>
              <button type="submit" className="btn-primary h-10 w-full sm:h-8 sm:w-auto" disabled={!!busy}>
                <Icon name={busy === "one" ? "loader" : "eye"} size={14} className={busy === "one" ? "animate-spin" : ""} />
                {busy === "one" ? t("Check ho raha hai…", "Checking…") : t("Check karke preview dekho", "Check & preview")}
              </button>
            </div>
          </form>
        </Section>
      </div>
    </div>
  );
}
