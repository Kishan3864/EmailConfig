"use client";
import { useState, useTransition } from "react";

/** Calls a server action and shows its returned message. */
export function ActionButton({ action, label, className = "btn", confirmText }: { action: () => Promise<string | void>; label: string; className?: string; confirmText?: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  const run = () => {
    if (confirmText && !armed) { setArmed(true); return; }
    setArmed(false);
    start(async () => {
      try { setMsg((await action()) || "Done"); }
      catch (e) { setMsg("Error: " + (e instanceof Error ? e.message : String(e))); }
    });
  };
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={run} disabled={pending} className={className}>
        {pending ? "Working…" : armed ? confirmText : label}
      </button>
      {msg && <span className={`text-xs whitespace-pre-wrap ${msg.startsWith("Error") ? "text-red-600" : "text-slate-600"}`}>{msg}</span>}
    </span>
  );
}
