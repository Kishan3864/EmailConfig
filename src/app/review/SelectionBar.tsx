"use client";
import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { useT } from "@/components/lang";
import { friendlyError, useToast } from "@/components/toast";
import { approveSelected } from "../actions";

/**
 * The bar under the Approve list: how many cards are ticked, "Sab chuno" / "Koi nahi", and "Selected approve karo".
 * The checkboxes live in the server-rendered cards (<input name="ids" form="approve-sel">) and belong to this bar's
 * form, so no list state is kept here. Approving asks for a second click within 5 seconds, like ActionButton's
 * confirmText. ids = the cards that can be ticked (only "Approval baaki" drafts; "Text chahiye" ones have no checkbox).
 */
export function SelectionBar({ ids, next, nextCta }: { ids: string[]; next?: string; nextCta?: string }) {
  const toast = useToast();
  const { t } = useT();
  const form = useRef<HTMLFormElement>(null);
  const [n, setN] = useState(0);
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();

  // form.elements also holds the inputs tied to the form by their form="approve-sel" attribute
  const boxes = useCallback(
    () => Array.from(form.current?.elements ?? []).filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === "checkbox" && el.name === "ids"),
    [],
  );
  const sync = useCallback(() => setN(boxes().filter((b) => b.checked).length), [boxes]);

  // the list changed (approved cards gone, another filter): count again, and never keep an old second-click armed
  const listKey = ids.join(",");
  useEffect(() => { sync(); setArmed(false); }, [listKey, sync]);
  useEffect(() => {
    const onChange = (e: Event) => {
      if (e.target instanceof HTMLInputElement && e.target.name === "ids" && e.target.form === form.current) { sync(); setArmed(false); }
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, [sync]);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  const setAll = (on: boolean) => {
    for (const b of boxes()) b.checked = on;
    sync();
    setArmed(false);
  };

  const run = (e?: FormEvent) => {
    e?.preventDefault();
    if (pending) return;
    const chosen = boxes().filter((b) => b.checked).map((b) => b.value);
    if (!chosen.length) {
      toast.info(t("Pehle mails chuno", "Select mails first"), t("Card pe checkbox lagao, ya ‘Sab chuno’ dabao.", "Tick the checkbox on a card, or press ‘Select all’."));
      return;
    }
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    start(async () => {
      try {
        toast.result(await approveSelected(chosen), { href: next, cta: nextCta });
      } catch (err) {
        toast.error(t("Mails approve nahi hui", "Mails not approved"), friendlyError(err, t));
      }
      sync();
    });
  };

  const all = n > 0 && n === ids.length;
  return (
    <form id="approve-sel" ref={form} onSubmit={run} aria-busy={pending}
      className="sticky bottom-[calc(env(safe-area-inset-bottom)+68px)] z-20 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2.5 shadow-pop backdrop-blur sm:px-4 lg:bottom-4">
      <span className="hidden text-sm font-medium tabular-nums text-slate-700 sm:inline" aria-live="polite">{t(`${n} chuni hui`, `${n} selected`)}</span>
      <button type="button" onClick={() => setAll(true)} disabled={pending || all} className="btn-ghost btn-sm">
        <Icon name="check-check" size={13} className="max-sm:hidden" />{t("Sab chuno", "Select all")}
      </button>
      <button type="button" onClick={() => setAll(false)} disabled={pending || !n} className="btn-ghost btn-sm">
        <Icon name="x" size={13} className="max-sm:hidden" />{t("Koi nahi", "None")}
      </button>
      <button type="submit" disabled={pending} aria-live="polite"
        className={`btn-success ml-auto ${armed ? "!border-amber-500 !bg-amber-500 !text-white ring-4 ring-amber-500/20" : ""} ${n ? "" : "opacity-60"}`}>
        <Icon name={pending ? "loader" : armed ? "alert" : "check"} size={14} className={pending ? "animate-spin" : ""} />
        {pending ? t("Approve ho rahi hain…", "Approving…") : armed ? (
          <>
            <span className="sm:hidden">{t(`Dobara dabao (${n})`, `Click again (${n})`)}</span>
            <span className="hidden sm:inline">{t(`Dobara dabao: ${n} mails approve hongi`, `Click again: approve ${n} mails`)}</span>
          </>
        ) : (
          <>
            <span className="sm:hidden">{t(`Approve karo (${n})`, `Approve (${n})`)}</span>
            <span className="hidden sm:inline">{t("Selected approve karo", "Approve selected")}</span>
          </>
        )}
      </button>
    </form>
  );
}
