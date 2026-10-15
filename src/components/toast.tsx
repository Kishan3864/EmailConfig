"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export type ToastKind = "success" | "error" | "warning" | "info";
/** reload: the CTA reloads the whole page (for problems a client-side navigation cannot fix) */
export type ToastInput = { kind?: ToastKind; title: string; text?: string; href?: string; cta?: string; duration?: number; reload?: boolean };
type Toast = ToastInput & { id: number; kind: ToastKind };
type ResultOpts = { okTitle?: string; errTitle?: string; href?: string; cta?: string };

const Ctx = createContext<((t: ToastInput) => void) | null>(null);
let seq = 0;

/**
 * Server actions report back with a plain string. "Error: …" means it failed, "Warning: …" means it partly worked,
 * anything else (or nothing) means it worked.
 */
export function resultKind(r: string | void | null | undefined): ToastKind {
  if (!r) return "success";
  if (/^error\b/i.test(r.trim())) return "error";
  if (/^warning\b/i.test(r.trim())) return "warning";
  return "success";
}
const stripPrefix = (r: string) => r.trim().replace(/^(error|warning)\s*:?\s*/i, "");

/** Turns a thrown error into something the user can act on (production hides server error details). */
export function friendlyError(e: unknown): string {
  const err = (e && typeof e === "object" ? e : {}) as { message?: string; digest?: string };
  const m = err.message || String(e ?? "");
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return "Server tak nahi pahunch paye. Internet check karke dobara try karo.";
  if (/omitted in production|server components render/i.test(m)) {
    return `Server pe error aaya${err.digest ? ` (code ${err.digest})` : ""}. Thodi der baad dobara try karo. Baar baar ho to server pe "pm2 logs outreach-web" mein ye code dhundho.`;
  }
  return m;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setList((l) => l.filter((t) => t.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const push = useCallback((t: ToastInput) => {
    const id = ++seq;
    const kind = t.kind || "info";
    setList((l) => [...l.filter((x) => !(x.title === t.title && x.text === t.text)), { ...t, id, kind }].slice(-4));
    const base = kind === "error" ? 9000 : kind === "warning" ? 7000 : 4500;
    const ms = t.duration ?? Math.min(15000, base + (t.text?.length || 0) * 25);
    timers.current.set(id, setTimeout(() => dismiss(id), ms));
  }, [dismiss]);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+10px)] lg:inset-x-auto lg:bottom-5 lg:right-5 lg:top-auto lg:items-end lg:px-0 lg:pt-0">
        {list.map((t) => <ToastCard key={t.id} t={t} onClose={() => dismiss(t.id)} />)}
      </div>
    </Ctx.Provider>
  );
}

const LOOK: Record<ToastKind, { icon: IconName; color: string; bar: string }> = {
  success: { icon: "check-circle", color: "text-emerald-600", bar: "bg-emerald-500" },
  error: { icon: "x-circle", color: "text-red-600", bar: "bg-red-500" },
  warning: { icon: "alert", color: "text-amber-500", bar: "bg-amber-400" },
  info: { icon: "info", color: "text-indigo-600", bar: "bg-indigo-500" },
};

function ToastCard({ t, onClose }: { t: Toast; onClose: () => void }) {
  const look = LOOK[t.kind];
  return (
    <div role={t.kind === "error" ? "alert" : "status"} className="pointer-events-auto relative flex w-full max-w-[380px] animate-toast-in items-start gap-2.5 overflow-hidden rounded-xl bg-white p-3 pl-3.5 pr-2 shadow-pop ring-1 ring-slate-900/[.07]">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${look.bar}`} />
      <Icon name={look.icon} size={18} className={`mt-px ${look.color}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-900">{t.title}</div>
        {t.text && <div className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600">{t.text}</div>}
        {t.reload ? (
          <button type="button" onClick={() => window.location.reload()} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
            {t.cta || "Dobara load karo"} <Icon name="refresh" size={12} />
          </button>
        ) : t.href && (
          <Link href={t.href} onClick={onClose} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
            {t.cta || "Dekho"} <Icon name="arrow-right" size={12} />
          </Link>
        )}
      </div>
      <button type="button" onClick={onClose} aria-label="Band karo" className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  return useMemo(() => {
    const show = ctx || (() => {});
    const make = (kind: ToastKind) => (title: string, text?: string, extra?: Partial<ToastInput>) => show({ ...extra, kind, title, text });
    return {
      show,
      success: make("success"),
      error: make("error"),
      warning: make("warning"),
      info: make("info"),
      /** Shows a server action's string result as the right kind of toast. Returns true when it was an error. */
      result(r: string | void | null | undefined, o: ResultOpts = {}) {
        const kind = resultKind(r);
        const msg = r ? stripPrefix(r) : "";
        const [first, ...more] = msg.split("\n");
        const rest = more.join("\n").trim() || undefined;
        if (kind === "error") {
          // errTitle names what failed; a multi-line message brings its own title; a one-liner goes under a generic title
          if (o.errTitle) show({ kind, title: o.errTitle, text: msg || undefined });
          else show(rest ? { kind, title: first, text: rest } : { kind, title: "Problem aa gayi", text: msg || undefined });
          return true;
        }
        if (kind === "warning") { show({ kind, title: rest ? first : "Dhyan do", text: rest || msg || undefined, href: o.href, cta: o.cta }); return false; }
        show({ kind, title: first || o.okTitle || "Ho gaya", text: rest, href: o.href, cta: o.cta });
        return false;
      },
    };
  }, [ctx]);
}

const fired = new Set<string>();

/**
 * Shows a toast once when it mounts, e.g. to surface a problem a server component found.
 * With `once` it shows only once per browser tab session.
 */
export function ToastOnMount({ once, ...t }: ToastInput & { once?: string }) {
  const toast = useToast();
  const key = once || `${t.kind}|${t.title}|${t.text}`;
  useEffect(() => {
    if (fired.has(key)) return; // dev StrictMode runs effects twice
    fired.add(key);
    setTimeout(() => fired.delete(key), 2000); // lets the same toast show again on a later visit
    if (once) {
      try {
        if (sessionStorage.getItem("toast:" + once)) return;
        sessionStorage.setItem("toast:" + once, "1");
      } catch { /* storage blocked: just show it */ }
    }
    toast.show(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
