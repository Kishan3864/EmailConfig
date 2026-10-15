"use client";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, Field } from "@/components/ui";
import { SubmitButton } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { useT } from "@/components/lang";
import { createCampaign } from "../actions";

/** count = free leads (Ready + 'Review chahiye'), review = how many of them still need review */
type L = { id: string; name: string; count: number; review: number; language: string; timezone: string };
/** A Settings template: lang = the language its text is in, ok = it passes the draft rules (filled with an example lead) */
export type TemplateChoice = { id: string; name: string; lang: string; ok: boolean };
// language names stay in English in both UI languages (that is how they are said in Hinglish too)
const LANGS: Record<string, string> = { en: "English", fr: "French", de: "German", es: "Spanish", it: "Italian", nl: "Dutch", pt: "Portuguese" };
const TZS = ["Europe/Paris", "Europe/Brussels", "Europe/Zurich", "Europe/London", "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Amsterdam", "Europe/Lisbon", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Toronto", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney", "Africa/Casablanca"];

// createCampaign redirects to the new campaign, so this stays a plain server-action form (no toast needed on success).
export function CampaignForm({ lists, templates }: { lists: L[]; templates: TemplateChoice[] }) {
  const { t } = useT();
  const [sel, setSel] = useState<L | undefined>(lists[0]);
  const [lang, setLang] = useState(lists[0]?.language || "en");
  const [tz, setTz] = useState(lists[0]?.timezone || "Europe/Paris");
  // the name follows the chosen list until the user types a name of their own
  const [name, setName] = useState(lists[0] ? `${lists[0].name} campaign` : "");
  const [ownName, setOwnName] = useState(false);
  const [mailType, setMailType] = useState("ai");
  if (!lists.length) {
    return <EmptyState icon="upload" title={t("Pehle leads import karo", "Import leads first")}
      text={t("Abhi koi nayi list nahi hai jiske leads campaign ke liye free hon.", "There is no new list yet whose leads are free for a campaign.")}
      href="/import" cta={t("Leads import karo", "Import leads")} />;
  }
  const leads = (n: number) => (n === 1 ? "lead" : "leads");
  const tpl = templates.find((x) => x.id === mailType);
  const tplNo = (x: TemplateChoice) => `Template ${x.id.slice(3)}`;
  const langName = (l: string) => LANGS[l] || l.toUpperCase();
  const toTemplates = <Link href="/settings#templates" className="link">Settings → Email templates</Link>;
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
        <Field className="sm:col-span-2 lg:col-span-4" label={t("Mail kaise banegi", "How mails are written")} info={t(
          "Do tareeke:\n• AI: har lead ke liye alag mail, sirf CSV mein di gayi sach details (business, contact, category, city, about, note) aur unki apni website ke title/description se. AI kabhi andaaza nahi lagata ki business kya karta hai, aur website ke design pe kabhi comment nahi karta.\n• Template 1, 2 ya 3: Settings → Email templates ka fixed text. Har lead ke liye sirf {{business}}, {{contact}}, {{city}} jaise placeholders bharte hain. Template campaign ki bhasha mein likha hona chahiye.\nDono tarah ki mail same rules (60–110 words, ek sawaal, koi link nahi) aur same approval se guzarti hai.",
          "Two ways:\n• AI: a separate mail for each lead, written only from the true details in the CSV (business, contact, category, city, about, note) and the title/description of their own website. The AI never guesses what a business does and never comments on their website's design.\n• Template 1, 2 or 3: the fixed text from Settings → Email templates. For each lead only placeholders like {{business}}, {{contact}}, {{city}} are filled in. The template must be written in the campaign's language.\nBoth kinds of mail go through the same rules (60–110 words, a question, no links) and the same approval.",
        )}
          hint={tpl
            ? t(
              <>Sabko same text jayega, sirf naam aur city jaisi details bharengi. Text {toTemplates} mein badlo; wo {langName(lang)} mein likha hona chahiye.</>,
              <>Everyone gets the same text; only details like the name and city are filled in. Edit it in {toTemplates}; it must be written in {langName(lang)}.</>,
            )
            : t("AI sirf CSV ki sach details use karta hai, aur unki website pe kabhi comment nahi karta.", "The AI uses only the true details from the CSV and never comments on their website.")}>
          <select name="mailType" className="input sm:max-w-[calc(50%-0.375rem)]" value={mailType} onChange={(e) => setMailType(e.target.value)}>
            <option value="ai">{t("AI har lead ke liye likhega", "AI writes each mail")}</option>
            {templates.map((x) => <option key={x.id} value={x.id}>{x.name.trim() ? `${tplNo(x)}: ${x.name.trim()}` : tplNo(x)}</option>)}
          </select>
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
          {tpl && (tpl.lang !== lang || !tpl.ok) && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700">
              <Icon name="alert" size={13} className="mt-px shrink-0" />
              <span>{tpl.lang !== lang
                ? t(
                  <>{tplNo(tpl)} ka text {langName(tpl.lang)} mein hai, par campaign ki bhasha {langName(lang)} hai, isliye iske drafts fail honge. Template {langName(lang)} mein likho ({toTemplates}) ya bhasha badlo.</>,
                  <>{tplNo(tpl)} is written in {langName(tpl.lang)}, but the campaign language is {langName(lang)}, so its drafts will fail. Write the template in {langName(lang)} ({toTemplates}) or change the language.</>,
                )
                : t(
                  <>{tplNo(tpl)} abhi mail ke rules pass nahi karta (jaise 60–110 words, aakhir mein sawaal), isliye iske drafts fail honge. Pehle {toTemplates} mein theek karo.</>,
                  <>{tplNo(tpl)} does not pass the mail rules yet (e.g. 60–110 words, a closing question), so its drafts will fail. Fix it in {toTemplates} first.</>,
                )}</span>
            </p>
          )}
        </div>
        <SubmitButton icon="plus" pendingText={t("Ban raha hai…", "Creating…")} className="btn-primary w-full sm:w-auto">{t("Campaign banao", "Create campaign")}</SubmitButton>
      </div>
    </form>
  );
}
