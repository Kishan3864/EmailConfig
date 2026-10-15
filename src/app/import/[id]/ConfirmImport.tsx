"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { friendlyError, useToast } from "@/components/toast";

/**
 * Adds the list's "Bhejenge" and "Review" rows as leads. review = rows waiting for approval (decides where the toast points next).
 * expected = rows the preview said would be added; 0 means confirming only closes the list, so nothing added is not a problem.
 */
export function ConfirmImport({ listId, review = 0, expected, className = "btn-primary" }: { listId: string; review?: number; expected?: number; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const running = useRef(false); // a fast double click must never confirm twice
  const pending = busy || refreshing;

  async function run() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const r = await fetch("/api/import/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listId }) });
      const j = (await r.json().catch(() => ({}))) as { created?: number; error?: string };
      if (!r.ok) toast.error("Import nahi hua", j.error || `Server ne error diya (${r.status})`);
      else if (!j.created && expected === 0) toast.success("List band ho gayi", "Is list se koi lead add nahi hona tha: saari rows pehle se skip thi.");
      else if (!j.created) toast.warning("Koi lead add nahi hua", "Confirm ke waqt saari rows skip ho gayi (jaise pehle se contact ho chuke the). Wajah table mein dekho.");
      else toast.success(
        j.created === 1 ? "1 lead add ho gaya" : `${j.created} leads add ho gaye`,
        review ? "'Review chahiye' wale Contacts mein approve karo, phir campaign banao." : "Ab campaign banao: pehle 5 sample mails banengi, unhe padh ke approve karna hai.",
        review ? { href: "/contacts?status=needs_review", cta: "Review wale dekho" } : { href: "/campaigns", cta: "Campaign banao" },
      );
      startRefresh(() => router.refresh());
    } catch (e) {
      toast.error("Server se jawab nahi aaya", friendlyError(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={run} disabled={pending} className={`${className} h-10 w-full shrink-0 sm:h-8 sm:w-auto`}>
      <Icon name={pending ? "loader" : "check"} size={14} className={pending ? "animate-spin" : ""} />
      {pending ? "Save ho raha hai…" : "Import confirm karo"}
    </button>
  );
}
