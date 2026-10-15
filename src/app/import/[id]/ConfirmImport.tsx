"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { useT } from "@/components/lang";
import { friendlyError, useToast } from "@/components/toast";

/**
 * Adds the list's "Bhejenge" (Will send) and "Review" rows as leads. review = rows waiting for approval (decides where the toast points next).
 * expected = rows the preview said would be added; 0 means confirming only closes the list, so nothing added is not a problem.
 */
export function ConfirmImport({ listId, review = 0, expected, className = "btn-primary" }: { listId: string; review?: number; expected?: number; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const { t } = useT();
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
      if (!r.ok) {
        toast.error(t("Import nahi hua", "Import failed"), j.error || t(`Server ne error diya (${r.status})`, `The server returned an error (${r.status})`));
      } else if (!j.created && expected === 0) {
        toast.success(t("List band ho gayi", "List closed"),
          t("Is list se koi lead add nahi hona tha: saari rows pehle se skip thi.", "No leads were going to be added from this list: every row was already skipped."));
      } else if (!j.created) {
        toast.warning(t("Koi lead add nahi hua", "No leads added"),
          t("Confirm ke waqt saari rows skip ho gayi (jaise pehle se contact ho chuke the). Wajah table mein dekho.", "Every row was skipped at confirm time (for example, already contacted). See the reasons in the table."));
      } else {
        toast.success(
          j.created === 1 ? t("1 lead add ho gaya", "1 lead added") : t(`${j.created} leads add ho gaye`, `${j.created} leads added`),
          review
            ? t("'Review chahiye' wale Contacts mein approve karo, phir campaign banao.", "Approve the 'Needs review' leads in Contacts, then create a campaign.")
            : t("Ab campaign banao: pehle 5 sample mails banengi, unhe padh ke approve karna hai.", "Now create a campaign: 5 sample mails are made first, for you to read and approve."),
          review ? { href: "/contacts?status=needs_review", cta: t("Review wale dekho", "See leads to review") } : { href: "/campaigns", cta: t("Campaign banao", "Create campaign") },
        );
      }
      startRefresh(() => router.refresh());
    } catch (e) {
      toast.error(t("Server se jawab nahi aaya", "No response from the server"), friendlyError(e, t));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={run} disabled={pending} className={`${className} h-10 w-full shrink-0 sm:h-8 sm:w-auto`}>
      <Icon name={pending ? "loader" : "check"} size={14} className={pending ? "animate-spin" : ""} />
      {pending ? t("Save ho raha hai…", "Saving…") : t("Import confirm karo", "Confirm import")}
    </button>
  );
}
