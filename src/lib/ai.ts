import { getSettings, type Settings } from "./settings";
import { LANGS } from "./lang";
import type { Facts } from "./facts";
import type { LeadExtra } from "./fsdb";
import { knownFacts, knowsWhatTheyDo, type KnownKey } from "./leadinfo";
import { validateDraft } from "./validate";

export async function chat(messages: { role: string; content: string }[], s?: Settings, json = true): Promise<string> {
  s = s || (await getSettings());
  const key = process.env.AI_API_KEY;
  if (!key) throw new Error("AI_API_KEY missing in .env");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const body: Record<string, unknown> = { model: s.aiModel, messages, temperature: 0.6 };
    if (json) body.response_format = { type: "json_object" };
    let res = await fetch(s.aiBaseUrl.replace(/\/$/, "") + "/chat/completions", {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (res.status === 400 && json) {
      // some OpenAI-compatible endpoints do not support response_format
      delete body.response_format;
      res = await fetch(s.aiBaseUrl.replace(/\/$/, "") + "/chat/completions", {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
    }
    if (!res.ok) throw new Error(`AI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } finally { clearTimeout(t); }
}

export function parseJson(text: string): Record<string, string> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI returned no JSON");
  return JSON.parse(m[0]);
}

type LeadIn = LeadExtra & { businessName?: string | null; website?: string | null; country?: string | null };

const KNOWN_LABEL: Record<KnownKey, string> = {
  business: "Business name",
  contact: "Contact person (greet them by this name)",
  category: "Type of business",
  city: "City",
  country: "Country",
  about: "What they do (from our notes)",
  note: "A true fact we know about them (you may mention it once, briefly)",
  siteTitle: "Their own website title (only to understand what they do; never mention the website)",
  siteDescription: "Their own website description (only to understand what they do; never mention the website)",
};

export async function generateDraft(lead: LeadIn, facts: Facts, lang: string, s: Settings) {
  const langName = LANGS[lang] || "English";
  const known = knownFacts(lead, facts);
  const contact = known.find((k) => k.key === "contact")?.value;
  const system = `You write short, honest, plain-text cold emails for ${s.business || "a web design studio"}, a web design business.
HARD RULES:
- Write in ${langName}. Plain text only. Body 70-100 words.
- Greeting: ${contact ? `greet the contact person by name, e.g. "Hello ${contact}," (in ${langName})` : `a neutral greeting without a name, e.g. "Hello," / "Bonjour,"`}.
- About the recipient, use ONLY the RECIPIENT FACTS below. Never guess or invent anything about them: not what they do, not their customers, problems, results, plans or feelings.
- NEVER mention or judge their website or online presence: no comments on design, speed, mobile, security, booking, ordering, reviews or SEO, and never say you visited, saw, checked, found or looked at their website or homepage.
- ${knowsWhatTheyDo(known) ? "Mention what kind of business they are once, naturally and respectfully, using only the facts." : "We do NOT know what this business does: do not describe their business at all. Write a short, general introduction of what the sender offers and why it can help a small business."}
- About the sender, use only the offer notes and proof points: no invented prices, budgets, timelines, guarantees, numbers, clients, results, awards or promises.
- Do not assume whether they already have a website or not.
- No flattery and no compliments that the facts do not support.
- End with ONE low-pressure question as the call to action (e.g. would it be useful if I sent a few ideas?).
- No urgency, no hype, no ALL CAPS, no exclamation marks in a row, no links/URLs, no placeholders, no "Re:" or "Fwd:" in the subject.
- Do NOT write a signature, sign-off name, footer or unsubscribe line: the app adds them.
- Subject: short (3-7 words), honest, plain; it may contain the business name.
Return JSON only: {"subject": "...", "body": "..."${lang !== "en" ? ', "subject_en": "English translation of subject", "body_en": "English translation of body"' : ""}}`;
  const user = `SENDER: ${s.senderName}, ${s.senderRole} at ${s.business || "freelance"}.
OFFER NOTES: ${s.offerWhat}
PROOF POINTS (only use if relevant, never exaggerate): ${s.offerProof || "none"}
TONE: ${s.offerTone}

RECIPIENT FACTS (all true; the only things you may say about the recipient):
${known.map((k) => `- ${KNOWN_LABEL[k.key]}: ${k.value}`).join("\n") || "- Nothing is known about them except their email address."}`;

  const out = parseJson(await chat([{ role: "system", content: system }, { role: "user", content: user }], s));
  const subject = String(out.subject || "").trim().replace(/^["']|["']$/g, "");
  const body = String(out.body || "").trim().replace(/\r/g, "");
  const errors = validateDraft(subject, body, lang, lead.businessName || "");
  return { subject, body, subjectEn: out.subject_en ? String(out.subject_en) : null, bodyEn: out.body_en ? String(out.body_en) : null, errors };
}

export async function translateToEnglish(text: string) {
  const out = parseJson(await chat([
    { role: "system", content: 'Translate the user text to English. Return JSON {"en": "..."} only.' },
    { role: "user", content: text.slice(0, 6000) },
  ]));
  return String(out.en || "");
}
