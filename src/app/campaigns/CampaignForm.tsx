"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { EmptyState, Field } from "@/components/ui";
import { SubmitButton } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { useT } from "@/components/lang";
import { forChip } from "@/components/siteText";
import { BY_SITE, suggestPair, tplNo, type TemplateFor, type TemplateId } from "@/lib/templates";
import { createCampaign } from "../actions";

/**
 * count = free leads (Ready + 'Review chahiye'), review = how many of them still need review,
 * noSite / site = how many of them have no website of their own / have one (lib/website.ts)
 */
type L = { id: string; name: string; count: number; review: number; noSite: number; site: number; language: string; timezone: string };
/**
 * A Settings template: for = whom it is written for (its "Kiske liye" tag), lang = the language its text is in,
 * ok = it passes the draft rules (filled with an example lead)
 */
export type TemplateChoice = { id: TemplateId; name: string; lang: string; ok: boolean; for: TemplateFor };
// language names stay in English in both UI languages (that is how they are said in Hinglish too)
const LANGS: Record<string, string> = { en: "English", fr: "French", de: "German", es: "Spanish", it: "Italian", nl: "Dutch", pt: "Portuguese" };
const TZS = ["Europe/Paris", "Europe/Brussels", "Europe/Zurich", "Europe/London", "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Amsterdam", "Europe/Lisbon", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Toronto", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney", "Africa/Casablanca"];

const Warn = ({ children }: { children: ReactNode }) => (
  <p className="flex items-start gap-1.5 text-xs text-amber-700">
    <Icon name="alert" size={13} className="mt-px shrink-0" /><span className="min-w-0">{children}</span>
  </p>
);
const Note = ({ children }: { children: ReactNode }) => (
  <p className="flex items-start gap-1.5 text-xs text-slate-500">
    <Icon name="info" size={13} className="mt-px shrink-0 text-slate-400" /><span className="min-w-0">{children}</span>
  </p>
);

// createCampaign redirects to the new campaign, so this stays a plain server-action form (no toast needed on success).
export function CampaignForm({ lists, templates }: { lists: L[]; templates: TemplateChoice[] }) {
  const { t } = useT();
  const [sel, setSel] = useState<L | undefined>(lists[0]);
  const [lang, setLang] = useState(lists[0]?.language || "en");
  const [tz, setTz] = useState(lists[0]?.timezone || "Europe/Paris");
  // the name follows the chosen list until the user types a name of their own
  const [name, setName] = useState(lists[0] ? `${lists[0].name} campaign` : "");
  const [ownName, setOwnName] = useState(false);
  const [mailType, setMailType] = useState<string>(BY_SITE);
  // the "by website" pair follows the suggestion for the campaign language (so also the list) until the user picks one by hand
  const [ownNoSite, setOwnNoSite] = useState<TemplateId | null>(null);
  const [ownSite, setOwnSite] = useState<TemplateId | null>(null);
  if (!lists.length) {
    return <EmptyState icon="upload" title={t("Pehle leads import karo", "Import leads first")}
      text={t("Abhi koi nayi list nahi hai jiske leads campaign ke liye free hon.", "There is no new list yet whose leads are free for a campaign.")}
      href="/import" cta={t("Leads import karo", "Import leads")} />;
  }
  const leads = (n: number) => (n === 1 ? "lead" : "leads");
  const langName = (l: string) => LANGS[l] || l.toUpperCase();
  const toTemplates = <Link href="/settings#templates" className="link">Settings → Email templates</Link>;
  const tplName = (x: TemplateChoice) => (x.name.trim() ? `${tplNo(x.id)}: ${x.name.trim()}` : tplNo(x.id));
  const option = (x: TemplateChoice) => <option key={x.id} value={x.id}>{`${tplName(x)} · ${forChip(x.for, t)}`}</option>;

  const bySite = mailType === BY_SITE;
  const one = templates.find((x) => x.id === mailType); // one template for every lead
  const pair = suggestPair(templates, lang);
  const noSiteId = ownNoSite ?? pair.nosite, siteId = ownSite ?? pair.site;
  const noSiteTpl = templates.find((x) => x.id === noSiteId), siteTpl = templates.find((x) => x.id === siteId);
  const noSiteN = sel?.noSite ?? 0, siteN = sel?.site ?? 0;

  // the templates this campaign fills, each with the group it goes to (a group with no lead in the list gets nothing)
  const uses: { tpl: TemplateChoice; group?: "nosite" | "site" }[] = bySite
    ? [...(noSiteTpl && noSiteN ? [{ tpl: noSiteTpl, group: "nosite" as const }] : []), ...(siteTpl && siteN ? [{ tpl: siteTpl, group: "site" as const }] : [])]
    : one ? [{ tpl: one }] : [];
  const used = [...new Map(uses.map((u) => [u.tpl.id, u.tpl])).values()];

  const warnings: ReactNode[] = [];
  for (const x of used) {
    if (x.lang !== lang) {
      warnings.push(<Warn key={`lang-${x.id}`}>{t(
        <>{tplNo(x.id)} ka text {langName(x.lang)} mein hai, par campaign ki bhasha {langName(lang)} hai, isliye iske drafts fail honge. Template {langName(lang)} mein likho ({toTemplates}) ya bhasha badlo.</>,
        <>{tplNo(x.id)} is written in {langName(x.lang)}, but the campaign language is {langName(lang)}, so its drafts will fail. Write the template in {langName(lang)} ({toTemplates}) or change the language.</>,
      )}</Warn>);
    } else if (!x.ok) {
      warnings.push(<Warn key={`rules-${x.id}`}>{t(
        <>{tplNo(x.id)} abhi mail ke rules pass nahi karta (jaise 60–110 words, aakhir mein sawaal), isliye iske drafts fail honge. Pehle {toTemplates} mein theek karo.</>,
        <>{tplNo(x.id)} does not pass the mail rules yet (e.g. 60–110 words, a closing question), so its drafts will fail. Fix it in {toTemplates} first.</>,
      )}</Warn>);
    }
  }
  // a template tagged for one group that would go to the other one (its text may talk about their website, or offer one)
  for (const u of uses) {
    if (u.group === "nosite" && u.tpl.for === "site") {
      warnings.push(<Warn key="for-nosite">{t(
        <>{tplNo(u.tpl.id)} ‘Kiske liye: Jinki website HAI’ tag ke saath likha gaya hai, par yahan ye un {noSiteN} leads ko jayega jinki website NAHI hai. Shayad text unki website ki baat karta hai: doosra template chuno ya {toTemplates} mein tag theek karo.</>,
        <>{tplNo(u.tpl.id)} is tagged ‘Written for: Leads with a website’, but here it goes to the {noSiteN} {leads(noSiteN)} without a website. Its text may talk about their website: choose another template or fix the tag in {toTemplates}.</>,
      )}</Warn>);
    }
    if (u.group === "site" && u.tpl.for === "nosite") {
      warnings.push(<Warn key="for-site">{t(
        <>{tplNo(u.tpl.id)} ‘Kiske liye: Jinki website NAHI hai’ tag ke saath likha gaya hai, par yahan ye un {siteN} leads ko jayega jinki website HAI. Shayad text unhe nayi website offer karta hai: doosra template chuno ya {toTemplates} mein tag theek karo.</>,
        <>{tplNo(u.tpl.id)} is tagged ‘Written for: Leads without a website’, but here it goes to the {siteN} {leads(siteN)} with a website. Its text may offer them a new website: choose another template or fix the tag in {toTemplates}.</>,
      )}</Warn>);
    }
  }
  // one template for everyone, but it is written for one group and the list has leads of the other one too
  const others = one?.for === "nosite" ? siteN : one?.for === "site" ? noSiteN : 0;
  if (one && others) {
    warnings.push(<Warn key="for-one">{one.for === "nosite"
      ? t(
        <>{tplNo(one.id)} ‘Kiske liye: Jinki website NAHI hai’ tag ke saath likha gaya hai, par is campaign mein ye sabko jayega, un {others} leads ko bhi jinki website HAI. Dono groups ke liye ‘Website ke hisaab se 2 templates’ chuno.</>,
        <>{tplNo(one.id)} is tagged ‘Written for: Leads without a website’, but in this campaign it goes to everyone, also to the {others} {leads(others)} with a website. To cover both groups, choose ‘Two templates, by website’.</>,
      )
      : t(
        <>{tplNo(one.id)} ‘Kiske liye: Jinki website HAI’ tag ke saath likha gaya hai, par is campaign mein ye sabko jayega, un {others} leads ko bhi jinki website NAHI hai. Dono groups ke liye ‘Website ke hisaab se 2 templates’ chuno.</>,
        <>{tplNo(one.id)} is tagged ‘Written for: Leads with a website’, but in this campaign it goes to everyone, also to the {others} {leads(others)} without a website. To cover both groups, choose ‘Two templates, by website’.</>,
      )}</Warn>);
  }

  // what the "by website" choice means for the chosen list
  const notes: ReactNode[] = [];
  if (bySite && !siteN) {
    notes.push(<Note key="all-nosite">{t(
      "Is list mein kisi lead ki apni website nahi hai: sabko ‘Jinki website NAHI hai’ wala template jayega.",
      "No lead in this list has a website of its own: everyone gets the ‘Leads without a website’ template.",
    )}</Note>);
  } else if (bySite && !noSiteN) {
    notes.push(<Note key="all-site">{t(
      "Is list ke sab leads ki apni website hai: sabko ‘Jinki website HAI’ wala template jayega.",
      "Every lead in this list has a website of its own: everyone gets the ‘Leads with a website’ template.",
    )}</Note>);
  } else if (bySite && noSiteId === siteId) {
    notes.push(<Note key="same">{t(
      "Dono groups ke liye same template chuna hai, isliye sabko ek hi text jayega.",
      "The same template is chosen for both groups, so everyone gets the same text.",
    )}</Note>);
  }

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
          "Teen tareeke:\n• Website ke hisaab se 2 templates: jinki apni website NAHI hai unhe ek template jayega, jinki website HAI unhe doosra. App har lead ki CSV wali website dekh ke khud sahi template chunta hai. Facebook, Instagram, Google Maps, directory ya booking site ka link apni website nahi ginta: aise lead ko ‘website NAHI hai’ wala template jayega.\n• AI: har lead ke liye alag mail, sirf CSV mein di gayi sach details (business, contact, category, city, about, note) aur unki apni website ke title/description se. AI kabhi andaaza nahi lagata ki business kya karta hai, aur website ke design pe kabhi comment nahi karta.\n• Ek template sabke liye (Template 1–6): Settings → Email templates ka fixed text, har lead ko same.\nTemplates mein har lead ke liye sirf {{business}}, {{contact}}, {{city}}, {{website}} jaise placeholders bharte hain, aur wo campaign ki bhasha mein likhe hone chahiye. Har tarah ki mail same rules (60–110 words, ek sawaal, koi link nahi) aur same approval se guzarti hai.",
          "Three ways:\n• Two templates, by website: leads without a website of their own get one template, leads with a website get another. The app looks at each lead's website from the CSV and picks the right template itself. A Facebook, Instagram, Google Maps, directory or booking-site link does not count as their own website: such a lead gets the ‘no website’ template.\n• AI: a separate mail for each lead, written only from the true details in the CSV (business, contact, category, city, about, note) and the title/description of their own website. The AI never guesses what a business does and never comments on their website's design.\n• One template for everyone (Template 1–6): the fixed text from Settings → Email templates, the same for every lead.\nIn a template only placeholders like {{business}}, {{contact}}, {{city}}, {{website}} are filled in for each lead, and it must be written in the campaign's language. Every kind of mail goes through the same rules (60–110 words, a question, no links) and the same approval.",
        )}
          hint={bySite
            ? t(
              <>Har lead ke liye app khud dekhta hai ki uski apni website hai ya nahi, aur usi hisaab se template bharta hai. Text {toTemplates} mein badlo; dono {langName(lang)} mein likhe hone chahiye.</>,
              <>For every lead the app checks whether it has a website of its own and fills the matching template. Edit the texts in {toTemplates}; both must be written in {langName(lang)}.</>,
            )
            : one
              ? t(
                <>Sabko same text jayega, sirf naam aur city jaisi details bharengi. Text {toTemplates} mein badlo; wo {langName(lang)} mein likha hona chahiye.</>,
                <>Everyone gets the same text; only details like the name and city are filled in. Edit it in {toTemplates}; it must be written in {langName(lang)}.</>,
              )
              : t("AI sirf CSV ki sach details use karta hai, aur unki website pe kabhi comment nahi karta.", "The AI uses only the true details from the CSV and never comments on their website.")}>
          <select name="mailType" className="input sm:max-w-[calc(50%-0.375rem)]" value={mailType} onChange={(e) => setMailType(e.target.value)}>
            <option value={BY_SITE}>{t("Website ke hisaab se 2 templates", "Two templates, by website")}</option>
            <option value="ai">{t("AI har lead ke liye likhega", "AI writes each mail")}</option>
            {templates.map(option)}
          </select>
        </Field>
        {/* only rendered (and so only submitted) for a "by website" campaign */}
        {bySite && (
          <div className="grid grid-cols-1 items-end gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-4">
            <Field label={t(`Jinki website NAHI hai (${noSiteN} leads)`, `Leads without a website (${noSiteN} ${leads(noSiteN)})`)} info={t(
              "Is list ke wo free leads jinki CSV mein koi website nahi hai, ya sirf Facebook, Instagram, Google Maps, directory ya booking site jaisa page hai. Inhe ye template jayega. Bracket mein unki ginti hai.",
              "The free leads of this list with no website in the CSV, or only a page like Facebook, Instagram, Google Maps, a directory or a booking site. They get this template. The number in brackets is their count.",
            )}>
              <select name="tplNoSite" className="input" value={noSiteId} onChange={(e) => setOwnNoSite(e.target.value as TemplateId)}>{templates.map(option)}</select>
            </Field>
            <Field label={t(`Jinki website HAI (${siteN} leads)`, `Leads with a website (${siteN} ${leads(siteN)})`)} info={t(
              "Is list ke wo free leads jinki apni website hai (CSV ke website column se). Inhe ye template jayega; template mein {{website}} unka domain ban jaata hai. Bracket mein unki ginti hai.",
              "The free leads of this list with a website of their own (from the CSV's website column). They get this template; {{website}} in it becomes their domain. The number in brackets is their count.",
            )}>
              <select name="tplSite" className="input" value={siteId} onChange={(e) => setOwnSite(e.target.value as TemplateId)}>{templates.map(option)}</select>
            </Field>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <Note>{t("Banane se koi mail nahi jaati. Agla step: 5 sample drafts banao aur padho.", "Creating it sends no mail. Next step: make and read 5 sample drafts.")}</Note>
          {notes}
          {sel && sel.review > 0 && (
            <Warn>{t(
              `Is list ke ${sel.review} lead ‘Review chahiye’ mein hain. Unhe Ready leads khatam hone se pehle Contacts mein approve karo, warna campaign khatam ho jayega aur wo reh jayenge.`,
              `${sel.review} ${leads(sel.review)} of this list ${sel.review === 1 ? "is" : "are"} in ‘Needs review’. Approve them in Contacts before the Ready leads run out, otherwise the campaign ends and they are left out.`,
            )}</Warn>
          )}
          {warnings}
        </div>
        <SubmitButton icon="plus" pendingText={t("Ban raha hai…", "Creating…")} className="btn-primary w-full sm:w-auto">{t("Campaign banao", "Create campaign")}</SubmitButton>
      </div>
    </form>
  );
}
