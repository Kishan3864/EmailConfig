"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ConfirmImport({ listId }: { listId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-sm">{msg}</span>}
      <button className="btn-primary" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await fetch("/api/import/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listId }) });
        const j = await r.json();
        setBusy(false);
        setMsg(r.ok ? `${j.created} leads added. Approve "needs review" ones in Contacts, then create a campaign.` : j.error);
        router.refresh();
      }}>{busy ? "Saving…" : "Confirm import"}</button>
    </span>
  );
}
