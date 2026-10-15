"use client";
import { useState } from "react";
import { EmptyState, Field } from "@/components/ui";
import { SubmitButton } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { useT } from "@/components/lang";
import { createCampaign } from "../actions";

/** count = free leads (Ready + 'Review chahiye'), review = how many of them still need review */
type L = { id: string; name: string; count: number; review: number; language: string; timezone: string };
// language names stay in English in both UI languages (that is how they are said in Hinglish too)
const LANGS: Record<string, string> = { en: "English", fr: "French", de: "German", es: "Spanish", it: "Italian", nl: "Dutch", pt: "Portuguese" };
const TZS = ["Europe/Paris", "Europe/Brussels", "Europe/Zurich", "Europe/London", "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Amsterdam", "Europe/Lisbon", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Toronto", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney", "Africa/Casablanca"];

// createCampaign redirects to the new campaign, so this stays a plain server-action form (no toast needed on success).
export function CampaignForm({ lists }: { lists: L[] }) {
  const { t } = useT();
  const [sel, setSel] = useState<L | undefined>(lists[0]);
  const [lang, setLang] = useState(lists[0]?.language || "en");
  const [tz, setTz] = useState(lists[0]?.timezone || "Europe/Paris");
  // the name follows the chosen list until the user types a name of their own
  const [name, setName] = useState(lists[0] ? `${lists[0].name} campaign` : "");
  const [ownName, setOwnName] = useState(false);
  if (!lists.length) {
    return <EmptyState icon="upload" title={t("Pehle leads import karo", "Import leads first")}
      text={t("Abhi koi nayi list nahi hai jiske leads campaign ke liye free hon.", "There is no new list yet whose leads are free for a campaign.")}
      href="/import" cta={t("Leads import karo", "Import leads")} />;
  }
  const leads = (n: number) => (n === 1 ? "lead" : "leads");
  return (
    <form action={createCampaign}>
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.85fr_1.15fr]">
        <Field label={t("Campaign ka naam", "Campaign name")} info={t("Sirf aapke pehchanne ke liye. Ye naam lead ko kabhi nahi dikhta.", "Only for you to recognise it. Leads never see this name.")}>
          <input name="name" className="input" required value={name} onChange={(e) => { setName(e.target.value); setOwnName(true); }} />
        </Field>
        <Field label="List" info={t(
          "Kis list ke leads ko mail jayegi. List ke saare free leads (Ready ya ‘Review chahiye’, jo kisi aur campaign mein nahi hain) is campaign mein jud jaate hain. Bracket mein unki ginti hai. ‘Review chahiye’ wale leads ko Ready leads khatam hone se pehle Contacts mein approve karo, warna campaign khatam ho jayega aur wo reh jayenge.",
          "Which list's leads get the mails. All free leads of the list (Ready or ‘Needs review’, not in another campaign) are added to this campaign. The number in brackets is their count. Approve the ‘Needs review’ leads in Contacts before the Ready leads run out, otherwise the campaign ends and they are left out.",
        )}>
          <select name="listId" className="input" value={sel?.id} onChange={(e) => {
            const l = lists.find((x) => x.id === e.target.value)!;
            setSel(l); setLang(l.language); setTz(l.timezone);
            if (!ownName || !name.trim()) setName(`${l.name} campaign`);
          }}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {t(
                  `${l.name} (${l.count} leads${l.review ? `, ${l.review} review baaki` : ""})`,
                  `${l.name} (${l.count} ${leads(l.count)}${l.review ? `, ${l.review} to review` : ""})`,
                )}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Bhasha (desh se apne aap)", "Language (auto from country)")} info={t(
          "Mails is bhasha mein likhi jayengi. List ke zyada-tar leads jis desh ke hain, uske hisaab se ye apne aap chuni jaati hai. Chaho to badal sakte ho.",
          "Mails will be written in this language. It is picked automatically from the country most leads in the list are from. You can change it.",
        )}>
          <select name="language" className="input" value={lang} onChange={(e) => setLang(e.target.value)}>{Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label={t("Timezone (sending window isi mein chalegi)", "Timezone (used for the sending window)")} info={t(
          "Sending window (jaise 09:30-17:30) aur daily limit isi timezone ke hisaab se chalti hai, taaki mail lead ke kaam ke samay pe pahunche. Ye bhi desh se apne aap chuna jaata hai.",
          "The sending window (e.g. 09:30-17:30) and the daily limit follow this timezone, so mails arrive during the lead's working hours. It is also picked automatically from the country.",
        )}>
          <select name="timezone" className="input" value={tz} onChange={(e) => setTz(e.target.value)}>{[...new Set([tz, ...TZS])].map((z) => <option key={z}>{z}</option>)}</select>
        </Field>
      </div>
      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <Icon name="info" size={13} className="mt-px shrink-0 text-slate-400" />
            {t("Banane se koi mail nahi jaati. Agla step: 5 sample drafts banao aur padho.", "Creating it sends no mail. Next step: make and read 5 sample drafts.")}
          </p>
          {sel && sel.review > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700">
              <Icon name="alert" size={13} className="mt-px shrink-0" />
              {t(
                `Is list ke ${sel.review} lead ‘Review chahiye’ mein hain. Unhe Ready leads khatam hone se pehle Contacts mein approve karo, warna campaign khatam ho jayega aur wo reh jayenge.`,
                `${sel.review} ${leads(sel.review)} of this list ${sel.review === 1 ? "is" : "are"} in ‘Needs review’. Approve them in Contacts before the Ready leads run out, otherwise the campaign ends and they are left out.`,
              )}
            </p>
          )}
        </div>
        <SubmitButton icon="plus" pendingText={t("Ban raha hai…", "Creating…")} className="btn-primary w-full sm:w-auto">{t("Campaign banao", "Create campaign")}</SubmitButton>
      </div>
    </form>
  );
}
