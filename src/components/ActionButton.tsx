"use client";
import { useEffect, useState, useTransition } from "react";
import { Icon, type IconName } from "./icons";
import { friendlyError, useToast } from "./toast";

/**
 * Calls a server action and shows its result as a toast ("Error: …" → red toast titled errTitle).
 * With confirmText the first click only arms the button; a second click within 5 seconds runs it.
 * next/nextCta add a "go here next" link to the success toast.
 */
export function ActionButton({ action, label, className = "btn", confirmText, icon, okTitle, errTitle, next, nextCta, pendingText = "Ho raha hai…" }: {
  action: () => Promise<string | void>; label: string; className?: string; confirmText?: string; icon?: IconName;
  okTitle?: string; errTitle?: string; next?: string; nextCta?: string; pendingText?: string;
}) {
  const toast = useToast();
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const run = () => {
    if (confirmText && !armed) { setArmed(true); return; }
    setArmed(false);
    start(async () => {
      try { toast.result(await action(), { okTitle, errTitle, href: next, cta: nextCta }); }
      catch (e) { toast.error(errTitle || "Problem aa gayi", friendlyError(e)); }
    });
  };

  return (
    <button type="button" onClick={run} disabled={pending} aria-live="polite"
      className={`${className} ${armed ? "!border-amber-500 !bg-amber-500 !text-white ring-4 ring-amber-500/20" : ""}`}>
      {pending ? <Icon name="loader" size={14} className="animate-spin" /> : armed ? <Icon name="alert" size={14} /> : icon ? <Icon name={icon} size={14} /> : null}
      {pending ? pendingText : armed ? confirmText : label}
    </button>
  );
}
