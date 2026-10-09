import { getSettings, type Settings } from "./settings";
import { LANGS } from "./lang";
import { factsForPrompt, type Facts } from "./facts";
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

type LeadIn = { businessName?: string | null; website?: string | null; country?: string | null };

export async function generateDraft(lead: LeadIn, facts: Facts, lang: string, s: Settings) {
  const langName = LANGS[lang] || "English";
  const system = `You write short, honest, plain-text cold emails for a freelance web designer.
HARD RULES:
- Write in ${langName}. Plain text only. Body 70-100 words. No greeting line with a person's name (use a neutral greeting like "Bonjour," / "Hello,").
- Use ONLY the facts listed below and the sender's offer notes. Do not invent compliments, numbers, clients, results, awards or claims.
- Exactly ONE specific, true observation taken from the facts.
- End with ONE low-pressure question as the call to action (e.g. would it be useful if I sent a few ideas?).
- No urgency, no hype, no ALL CAPS, no exclamation marks in a row, no links/URLs, no placeholders, no "Re:" or "Fwd:" in the subject.
- Do NOT write a signature, sign-off name, footer or unsubscribe line: the app adds them.
- Subject: short (3-7 words), lowercase-friendly, honest, specific to the business.
Return JSON only: {"subject": "...", "body": "..."${lang !== "en" ? ', "subject_en": "English translation of subject", "body_en": "English translation of body"' : ""}}`;
  const user = `SENDER: ${s.senderName}, ${s.senderRole} at ${s.business || "freelance"}.
OFFER NOTES: ${s.offerWhat}
PROOF POINTS (only use if relevant, never exaggerate): ${s.offerProof || "none"}
TONE: ${s.offerTone}

RECIPIENT BUSINESS: ${lead.businessName || "(name unknown)"}${lead.country ? `, ${lead.country}` : ""}
FACTS (checked on their homepage, the only facts you may use):
${factsForPrompt(facts)}
${facts.hasWebsite ? "" : 'Angle: they have no website; explain briefly how a simple site could help them be found, without assuming anything else.'}`;

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
