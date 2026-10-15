/**
 * UI language. "hi" = Hinglish (the default), "en" = English. The choice lives in the "lang" cookie.
 * Every UI text is written next to its translation: t("Hinglish text", "English text").
 * Server code gets t from getT() (lib/i18n-server.ts), client components from useT() (components/lang.tsx).
 */
export type Lang = "hi" | "en";
export const LANG_COOKIE = "lang";
export const LANGS: { id: Lang; label: string; short: string }[] = [
  { id: "hi", label: "Hinglish", short: "HI" },
  { id: "en", label: "English", short: "EN" },
];

export const toLang = (v?: string | null): Lang => (v === "en" ? "en" : "hi");

/** Picks the text (or JSX) for the current language. */
export type T = <V>(hi: V, en: V) => V;
export const makeT = (lang: Lang): T => (hi, en) => (lang === "en" ? en : hi);

/** <html lang>: Hinglish is Hindi written in Latin letters. */
export const htmlLang = (lang: Lang) => (lang === "en" ? "en" : "hi-Latn");
