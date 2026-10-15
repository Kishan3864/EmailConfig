"use client";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { LANG_COOKIE, LANGS, htmlLang, makeT, type Lang } from "@/lib/i18n";
import { Icon } from "./icons";

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; pending: boolean }>({ lang: "hi", setLang: () => {}, pending: false });

/** Holds the UI language for client components; switching stores the cookie and re-renders the server parts. */
export function LangProvider({ lang: initial, children }: { lang: Lang; children: ReactNode }) {
  const router = useRouter();
  const [lang, setState] = useState(initial);
  const [pending, start] = useTransition();
  useEffect(() => setState(initial), [initial]);
  const setLang = useCallback((l: Lang) => {
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = htmlLang(l);
    setState(l); // the client parts switch at once (not inside the transition, which would wait for the server)
    start(() => router.refresh()); // the server-rendered parts follow when the refresh arrives
  }, [router]);
  const value = useMemo(() => ({ lang, setLang, pending }), [lang, setLang, pending]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);

/** t("Hinglish", "English") for client components. */
export function useT() {
  const { lang } = useContext(Ctx);
  return useMemo(() => ({ lang, t: makeT(lang) }), [lang]);
}

/** The global Hinglish / English switch (short "HI / EN" labels on phones). */
export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang, setLang, pending } = useLang();
  const { t } = useT();
  return (
    <div role="group" aria-label={t("Bhasha", "Language")} className={`inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-slate-200/60 p-0.5 ${className}`}>
      <Icon name={pending ? "loader" : "globe"} size={13} className={`mx-1 text-slate-500 ${pending ? "animate-spin" : ""}`} />
      {LANGS.map((l) => (
        <button key={l.id} type="button" aria-pressed={lang === l.id} title={l.label}
          onClick={() => { if (lang !== l.id) setLang(l.id); }}
          className={`h-7 rounded-md px-2 text-2xs font-semibold transition sm:h-6 ${lang === l.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
          <span className="sm:hidden">{l.short}</span>
          <span className="hidden sm:inline">{l.label}</span>
        </button>
      ))}
    </div>
  );
}
