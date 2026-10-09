// Country -> language / timezone, footer texts, crude language detection

const COUNTRY: Record<string, [string, string]> = {
  fr: ["fr", "Europe/Paris"], france: ["fr", "Europe/Paris"], be: ["fr", "Europe/Brussels"], belgium: ["fr", "Europe/Brussels"], belgique: ["fr", "Europe/Brussels"],
  ch: ["fr", "Europe/Zurich"], switzerland: ["fr", "Europe/Zurich"], suisse: ["fr", "Europe/Zurich"], lu: ["fr", "Europe/Luxembourg"], luxembourg: ["fr", "Europe/Luxembourg"],
  ma: ["fr", "Africa/Casablanca"], morocco: ["fr", "Africa/Casablanca"], maroc: ["fr", "Africa/Casablanca"],
  de: ["de", "Europe/Berlin"], germany: ["de", "Europe/Berlin"], deutschland: ["de", "Europe/Berlin"], at: ["de", "Europe/Vienna"], austria: ["de", "Europe/Vienna"],
  es: ["es", "Europe/Madrid"], spain: ["es", "Europe/Madrid"], espana: ["es", "Europe/Madrid"], españa: ["es", "Europe/Madrid"], mx: ["es", "America/Mexico_City"], mexico: ["es", "America/Mexico_City"],
  it: ["it", "Europe/Rome"], italy: ["it", "Europe/Rome"], italia: ["it", "Europe/Rome"],
  nl: ["nl", "Europe/Amsterdam"], netherlands: ["nl", "Europe/Amsterdam"], nederland: ["nl", "Europe/Amsterdam"],
  pt: ["pt", "Europe/Lisbon"], portugal: ["pt", "Europe/Lisbon"], br: ["pt", "America/Sao_Paulo"], brazil: ["pt", "America/Sao_Paulo"],
  uk: ["en", "Europe/London"], gb: ["en", "Europe/London"], "united kingdom": ["en", "Europe/London"], ie: ["en", "Europe/Dublin"], ireland: ["en", "Europe/Dublin"],
  us: ["en", "America/New_York"], usa: ["en", "America/New_York"], "united states": ["en", "America/New_York"], ca: ["en", "America/Toronto"], canada: ["en", "America/Toronto"],
  au: ["en", "Australia/Sydney"], australia: ["en", "Australia/Sydney"], in: ["en", "Asia/Kolkata"], india: ["en", "Asia/Kolkata"],
  ae: ["en", "Asia/Dubai"], uae: ["en", "Asia/Dubai"], sg: ["en", "Asia/Singapore"], singapore: ["en", "Asia/Singapore"], nz: ["en", "Pacific/Auckland"],
};

export const LANGS: Record<string, string> = { en: "English", fr: "French", de: "German", es: "Spanish", it: "Italian", nl: "Dutch", pt: "Portuguese" };

export function countryInfo(country?: string | null) {
  const k = (country || "").trim().toLowerCase();
  return COUNTRY[k] ? { language: COUNTRY[k][0], timezone: COUNTRY[k][1] } : null;
}

const STOP: Record<string, string[]> = {
  en: ["the", "and", "you", "your", "is", "for", "with", "that", "this", "are", "have", "would", "it", "of", "to"],
  fr: ["le", "la", "les", "et", "vous", "votre", "est", "pour", "avec", "que", "une", "des", "sur", "pas", "je"],
  de: ["der", "die", "das", "und", "sie", "ihre", "ist", "für", "mit", "nicht", "ein", "eine", "auf", "ich", "zu"],
  es: ["el", "la", "los", "y", "usted", "su", "es", "para", "con", "que", "una", "por", "del", "no", "se"],
  it: ["il", "la", "e", "per", "con", "che", "una", "del", "non", "sono", "di", "suo", "vostro", "è", "ho"],
  nl: ["de", "het", "en", "u", "uw", "is", "voor", "met", "dat", "een", "niet", "op", "ik", "van", "zijn"],
  pt: ["o", "a", "os", "e", "você", "seu", "é", "para", "com", "que", "uma", "do", "não", "da", "em"],
};

export function detectLang(text: string): string {
  const words = text.toLowerCase().split(/[^a-zà-ÿäöüßñ]+/).filter(Boolean);
  let best = "en", bestScore = -1;
  for (const [l, list] of Object.entries(STOP)) {
    const set = new Set(list);
    const score = words.filter((w) => set.has(w)).length;
    if (score > bestScore) { best = l; bestScore = score; }
  }
  return best;
}

type Foot = { found: (src: string) => string; stop: string };
const FOOT: Record<string, Foot> = {
  en: { found: (s) => `I found your address on ${s}.`, stop: `If you'd rather not hear from me, reply STOP and I won't write again.` },
  fr: { found: (s) => `J'ai trouvé votre adresse sur ${s}.`, stop: `Si vous ne souhaitez plus recevoir de message, répondez STOP et je ne vous écrirai plus.` },
  de: { found: (s) => `Ich habe Ihre Adresse auf ${s} gefunden.`, stop: `Wenn Sie keine weiteren Nachrichten wünschen, antworten Sie mit STOP und ich schreibe Ihnen nicht mehr.` },
  es: { found: (s) => `Encontré su dirección en ${s}.`, stop: `Si prefiere no recibir más mensajes, responda STOP y no volveré a escribirle.` },
  it: { found: (s) => `Ho trovato il vostro indirizzo su ${s}.`, stop: `Se preferite non ricevere altri messaggi, rispondete STOP e non vi scriverò più.` },
  nl: { found: (s) => `Ik vond uw adres op ${s}.`, stop: `Wilt u geen berichten meer ontvangen? Antwoord STOP en ik schrijf u niet meer.` },
  pt: { found: (s) => `Encontrei o seu endereço em ${s}.`, stop: `Se preferir não receber mais mensagens, responda STOP e não voltarei a escrever.` },
};

export function footer(lang: string, source: string, postal: string) {
  const f = FOOT[lang] || FOOT.en;
  return ["--", f.found(source), f.stop, postal].filter(Boolean).join("\n");
}
