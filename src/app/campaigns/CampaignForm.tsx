"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { EmptyState, Field } from "@/components/ui";
import { SubmitButton } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Info } from "@/components/Info";
import { useT } from "@/components/lang";
import { forText, siteGroup } from "@/components/siteText";
import { BY_SITE, MAX_PER_GROUP, suggestGroup, tplNo, type Group, type TemplateFor, type TemplateId } from "@/lib/templates";
import { createCampaign } from "../actions";

/**
 * count = free leads (Ready + 'Review chahiye'), review = how many of them still need review,
 * noSite / site = how many of them have no website of their own / have one (lib/website.ts),
 * own = leads with their own subject + body in the file (they get that text, not a template or the AI),
 * noObs = per group, the other leads without an {{observation}} (a template that needs one makes a "Text chahiye" draft)
 */
type L = {
  id: string; name: string; count: number; review: number; noSite: number; site: number; own: number;
  noObs: Record<Group, number>; language: string; timezone: string;
};
/**
 * A Settings template: for = its group tag ("Kiske liye"; any = fits both groups), lang = its Language (set in Settings,
 * else read from its text), textLang = the language its text is really written in, ok = it passes the draft rules in
 * its Language (filled with an example lead; a text in another language fails, as in Settings), observation = it uses
 * {{observation}}
 */
export type TemplateChoice = { id: TemplateId; name: string; lang: string; textLang: string; ok: boolean; for: TemplateFor; observation: boolean };
// language names stay in English in both UI languages (that is how they are said in Hinglish too)
const LANGS: Record<string, string> = { en: "English", fr: "French", de: "German", es: "Spanish", it: "Italian", nl: "Dutch", pt: "Portuguese" };
const TZS = ["Europe/Paris", "Europe/Brussels", "Europe/Zurich", "Europe/London", "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Amsterdam", "Europe/Lisbon", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Toronto", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney", "Africa/Casablanca"];
const GROUPS: Group[] = ["nosite", "site"];
// the checkbox names createCampaign reads (fd.getAll)
const FIELD: Record<Group, string> = { nosite: "tplNoSite", site: "tplSite" };

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
  // the ticks of a "by website" group follow the suggestion for the campaign language (so also the list) until the user
  // ticks that group by hand
  const [ownTicks, setOwnTicks] = useState<Partial<Record<Group, TemplateId[]>>>({});
  if (!lists.length) {
    return <EmptyState icon="upload" title={t("Pehle leads import karo", "Import leads first")}
      text={t("Abhi koi nayi list nahi hai jiske leads campaign ke liye free hon.", "There is no new list yet whose leads are free for a campaign.")}
      href="/import" cta={t("Leads import karo", "Import leads")} />;
  }
  const leads = (n: number) => (n === 1 ? "lead" : "leads");
  const langName = (l: string) => LANGS[l] || l.toUpperCase();
  const toTemplates = <Link href="/settings#templates" className="link">Settings → Email templates</Link>;
  const tplName = (x: TemplateChoice) => (x.name.trim() ? `${tplNo(x.id)}: ${x.name.trim()}` : tplNo(x.id));
  const order = (ids: TemplateId[]) => templates.filter((x) => ids.includes(x.id)).map((x) => x.id); // Settings order = rotation order
  const byId = (id: TemplateId) => templates.find((x) => x.id === id)!;

  const bySite = mailType === BY_SITE;
  const one = templates.find((x) => x.id === mailType); // one template for every lead
  const n: Record<Group, number> = { nosite: sel?.noSite ?? 0, site: sel?.site ?? 0 };
  const noObs: Record<Group, number> = sel?.noObs ?? { nosite: 0, site: 0 };

  // a group lists the templates tagged for it or for both; the default ticks are the suggestion for the campaign language
  // (none when no template of the group is in that language: then nothing is ticked and I choose myself)
  const choices = (g: Group) => templates.filter((x) => x.for === g || x.for === "any");
  const noneInLang = (g: Group) => !choices(g).some((x) => x.lang === lang);
  const suggested = (g: Group) => {
    const c = choices(g);
    return c.length ? order(suggestGroup(c, lang, g).filter((id) => c.some((x) => x.id === id))) : [];
  };
  const ticks: Record<Group, TemplateId[]> = { nosite: ownTicks.nosite ?? suggested("nosite"), site: ownTicks.site ?? suggested("site") };
  const toggle = (g: Group, id: TemplateId, on: boolean) => {
    const cur = ticks[g];
    setOwnTicks({ ...ownTicks, [g]: on ? order([...cur, id]).slice(0, MAX_PER_GROUP) : cur.filter((x) => x !== id) });
  };
  const empty = GROUPS.filter((g) => !ticks[g].length);
  const blocked = bySite && empty.length > 0;

  // its text is in another language than its own Language says: Settings shows it as failing. The drafts are checked
  // against the campaign language, so with a text in the campaign language they would still pass that rule.
  const mislabeled = (x: TemplateChoice) => x.textLang !== x.lang && x.textLang === lang;
  // why a template's drafts would fail in this campaign (short, shown next to it)
  const problem = (x: TemplateChoice): string | null => {
    if (x.textLang !== x.lang) {
      return mislabeled(x)
        ? t(
          `Text ${langName(x.textLang)} mein likha hai, par iski Bhasha ${langName(x.lang)} set hai, isliye Settings mein ye fail dikhta hai: wahan Bhasha ${langName(x.textLang)} karo`,
          `Written in ${langName(x.textLang)}, but its Language says ${langName(x.lang)}, so Settings shows it as failing: set its Language to ${langName(x.textLang)} there`,
        )
        : t(
          `Text ${langName(x.textLang)} mein likha hai, par iski Bhasha ${langName(x.lang)} set hai: ${langName(lang)} campaign mein iske drafts fail honge`,
          `Written in ${langName(x.textLang)}, but its Language says ${langName(x.lang)}: in a ${langName(lang)} campaign its drafts will fail`,
        );
    }
    if (x.lang !== lang) {
      return t(
        `${langName(x.lang)} mein likha hai, par campaign ${langName(lang)} mein hai: iske drafts fail honge`,
        `Written in ${langName(x.lang)}, but the campaign is in ${langName(lang)}: its drafts will fail`,
      );
    }
    if (!x.ok) return t("Mail ke rules pass nahi karta (jaise 60–110 words, aakhir mein sawaal): iske drafts fail honge", "Does not pass the mail rules (e.g. 60–110 words, a closing question): its drafts will fail");
    return null;
  };

  // the templates this campaign fills, each with the group it goes to (a group with no lead in the list gets nothing)
  const uses: { tpl: TemplateChoice; group?: Group }[] = bySite
    ? GROUPS.flatMap((g) => (n[g] ? ticks[g].map((id) => ({ tpl: byId(id), group: g })) : []))
    : one ? [{ tpl: one }] : [];
  const used = [...new Map(uses.map((u) => [u.tpl.id, u.tpl])).values()];

  const warnings: ReactNode[] = [];
  if (bySite) {
    // the reason is shown next to each template above; here only which ticked ones would fail (a template whose
    // Language is only set wrong keeps its own line above: its drafts may still pass)
    const failing = used.filter((x) => problem(x) && !mislabeled(x));
    if (failing.length) {
      const list = failing.map((x) => tplNo(x.id)).join(", ");
      warnings.push(<Warn key="failing">{t(
        <>Ticked templates mein se {list} ke drafts fail honge (wajah upar har template ke saath likhi hai). {toTemplates} mein theek karo ya doosra template tick karo.</>,
        <>Of the ticked templates, {list} will make failing drafts (the reason is shown next to each template above). Fix {failing.length === 1 ? "it" : "them"} in {toTemplates} or tick another template.</>,
      )}</Warn>);
    }
    if (empty.length) {
      const groups = (gs: Group[], and: string) => gs.map((g) => `‘${siteGroup(g === "site", t)}’`).join(and);
      // a group with no template in the campaign language gets no suggested tick
      const noLang = empty.filter((g) => choices(g).length > 0 && noneInLang(g));
      warnings.push(<Warn key="empty">{t(
        <>{groups(empty, " aur ")} mein kam se kam 1 template tick karo, tabhi campaign banega.{noLang.length > 0 && <> {groups(noLang, " aur ")} ka koi template {langName(lang)} mein nahi likha hai: {toTemplates} mein ek likho ya khud ek tick karo.</>}</>,
        <>Tick at least 1 template in {groups(empty, " and ")} to create the campaign.{noLang.length > 0 && <> No template of {groups(noLang, " or ")} is written in {langName(lang)}: write one in {toTemplates} or tick one by hand.</>}</>,
      )}</Warn>);
    }
  } else if (one) {
    if (one.textLang !== lang) {
      // drafts are checked against the campaign language, so the text's own language decides
      warnings.push(<Warn key="lang">{t(
        <>{tplNo(one.id)} ka text {langName(one.textLang)} mein hai{one.lang !== one.textLang ? ` (iski Bhasha ${langName(one.lang)} set hai)` : ""}, par campaign ki bhasha {langName(lang)} hai, isliye iske drafts fail honge. Template {langName(lang)} mein likho ({toTemplates}) ya bhasha badlo.</>,
        <>{tplNo(one.id)} is written in {langName(one.textLang)}{one.lang !== one.textLang ? ` (its Language says ${langName(one.lang)})` : ""}, but the campaign language is {langName(lang)}, so its drafts will fail. Write the template in {langName(lang)} ({toTemplates}) or change the language.</>,
      )}</Warn>);
    } else if (one.lang !== one.textLang) {
      warnings.push(<Warn key="lang-set">{t(
        <>{tplNo(one.id)} ka text {langName(one.textLang)} mein hai, par iski Bhasha {langName(one.lang)} set hai, isliye Settings mein ye fail dikhta hai. {toTemplates} mein Bhasha {langName(one.textLang)} karo.</>,
        <>{tplNo(one.id)} is written in {langName(one.textLang)}, but its Language says {langName(one.lang)}, so Settings shows it as failing. Set its Language to {langName(one.textLang)} in {toTemplates}.</>,
      )}</Warn>);
    } else if (!one.ok) {
      warnings.push(<Warn key="rules">{t(
        <>{tplNo(one.id)} abhi mail ke rules pass nahi karta (jaise 60–110 words, aakhir mein sawaal), isliye iske drafts fail honge. Pehle {toTemplates} mein theek karo.</>,
        <>{tplNo(one.id)} does not pass the mail rules yet (e.g. 60–110 words, a closing question), so its drafts will fail. Fix it in {toTemplates} first.</>,
      )}</Warn>);
    }
    // one template for everyone, but it is tagged for one group and the list has leads of the other one too
    const others = one.for === "nosite" ? n.site : one.for === "site" ? n.nosite : 0;
    if (others) {
      warnings.push(<Warn key="for-one">{one.for === "nosite"
        ? t(
          <>{tplNo(one.id)} ka group ‘{siteGroup(false, t)}’ hai, par is campaign mein ye sabko jayega, un {others} leads ko bhi jinki apni website HAI. Dono groups ke liye ‘Website ke hisaab se templates’ chuno.</>,
          <>{tplNo(one.id)} is tagged ‘{siteGroup(false, t)}’, but in this campaign it goes to everyone, also to the {others} {leads(others)} with a website of their own. To cover both groups, choose ‘Templates by website’.</>,
        )
        : t(
          <>{tplNo(one.id)} ka group ‘{siteGroup(true, t)}’ hai, par is campaign mein ye sabko jayega, un {others} leads ko bhi jinki apni website NAHI hai. Dono groups ke liye ‘Website ke hisaab se templates’ chuno.</>,
          <>{tplNo(one.id)} is tagged ‘{siteGroup(true, t)}’, but in this campaign it goes to everyone, also to the {others} {leads(others)} without a website of their own. To cover both groups, choose ‘Templates by website’.</>,
        )}</Warn>);
    }
  }

  // what the choice means for the chosen list
  const notes: ReactNode[] = [];
  if (bySite && !n.site) {
    notes.push(<Note key="all-nosite">{t(
      `Is list mein kisi lead ki apni website nahi hai: sabko ‘${siteGroup(false, t)}’ group ke templates jayenge.`,
      `No lead in this list has a website of its own: everyone gets the ‘${siteGroup(false, t)}’ templates.`,
    )}</Note>);
  } else if (bySite && !n.nosite) {
    notes.push(<Note key="all-site">{t(
      `Is list ke sab leads ki apni website hai: sabko ‘${siteGroup(true, t)}’ group ke templates jayenge.`,
      `Every lead in this list has a website of its own: everyone gets the ‘${siteGroup(true, t)}’ templates.`,
    )}</Note>);
  } else if (bySite && ticks.nosite.length && ticks.nosite.join() === ticks.site.join()) {
    notes.push(<Note key="same">{t(
      "Dono groups mein same templates ticked hain, isliye website hone ya na hone se text nahi badlega.",
      "Both groups have the same templates ticked, so having a website or not makes no difference to the text.",
    )}</Note>);
  }
  // {{observation}} never gets a stand-in: a lead without one gets a draft that waits for my own words
  const obsLeads = bySite
    ? GROUPS.reduce((k, g) => k + (ticks[g].some((id) => byId(id).observation) ? noObs[g] : 0), 0)
    : one?.observation ? noObs.nosite + noObs.site : 0;
  if (obsLeads) {
    notes.push(<Note key="observation">{t(
      `Ticked template {{observation}} use karta hai, par ${obsLeads} leads ki observation file mein nahi hai. Jinhe aisa template milega, unki draft ‘Text chahiye’ mein aayegi: [OBSERVATION] wali jagah aap khud likhoge, tabhi wo approve ho sakegi.`,
      `A chosen template uses {{observation}}, but ${obsLeads} ${leads(obsLeads)} have no observation in the file. Those that get such a template get a ‘Needs your text’ draft: you write the [OBSERVATION] part yourself before it can be approved.`,
    )}</Note>);
  }
  if (sel && sel.own > 0) {
    notes.push(<Note key="own">{t(
      `Is list ke ${sel.own} leads ki file mein apna subject aur body hai: unhe template ya AI ki jagah wahi text jayega (same rules check hote hain).`,
      `${sel.own} ${leads(sel.own)} of this list ${sel.own === 1 ? "has its" : "have their"} own subject and body in the file: ${sel.own === 1 ? "it gets" : "they get"} that text instead of a template or the AI (the same rules are checked).`,
    )}</Note>);
  }

  // one "by website" group: a checkbox per template that fits it (1-3 ticked), used in turn for the group's leads
  const groupBox = (g: Group) => {
    const list = choices(g);
    const on = ticks[g];
    const full = on.length >= MAX_PER_GROUP;
    const label = t(`${siteGroup(g === "site", t)} (${n[g]} leads)`, `${siteGroup(g === "site", t)} (${n[g]} ${leads(n[g])})`);
    return (
      <div key={g} role="group" aria-labelledby={`grp-${g}`} className="min-w-0 rounded-lg border border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span id={`grp-${g}`} className="flex min-w-0 items-center gap-1 text-xs font-medium text-slate-600">
            <span className="break-words">{label}</span>
            <Info size={12} title={label} text={g === "nosite"
              ? t(
                "Is list ke wo free leads jinki CSV mein koi website nahi hai, ya sirf Facebook, Instagram, Google Maps, directory, booking / delivery site, ya wixsite.com, eatbu.com jaise free builder page ka link hai. Yahan sirf wahi templates dikhte hain jinka group ‘Bina website’ ya ‘Dono’ hai (Settings → Email templates). 1–3 tick karo: is group ke leads ko wo baari-baari se milte hain.",
                "The free leads of this list with no website in the CSV, or only a link to Facebook, Instagram, Google Maps, a directory, a booking / delivery site or a free builder page like wixsite.com or eatbu.com. Only templates tagged ‘No website’ or ‘Both’ are listed here (Settings → Email templates). Tick 1–3: the leads of this group get them in turn.",
              )
              : t(
                "Is list ke wo free leads jinki apni website hai (CSV ke website column se); template mein {{website}} unka domain ban jaata hai. Yahan sirf wahi templates dikhte hain jinka group ‘Website hai’ ya ‘Dono’ hai (Settings → Email templates). 1–3 tick karo: is group ke leads ko wo baari-baari se milte hain.",
                "The free leads of this list with a website of their own (from the CSV's website column); {{website}} in a template becomes their domain. Only templates tagged ‘Has a website’ or ‘Both’ are listed here (Settings → Email templates). Tick 1–3: the leads of this group get them in turn.",
              )} />
          </span>
          <span className={`text-2xs tabular-nums ${full ? "font-medium text-slate-600" : "text-slate-400"}`}>
            {t(`${on.length} ticked · 3 tak`, `${on.length} ticked · up to 3`)}
          </span>
        </div>
        {list.length ? (
          <div className="mt-2 space-y-0.5">
            {list.map((x) => {
              const checked = on.includes(x.id);
              const off = !checked && full;
              const why = problem(x);
              return (
                <label key={x.id} title={off ? t("3 tak hi tick ho sakte hain: pehle ek hatao", "At most 3 can be ticked: untick one first") : undefined}
                  className={`flex items-start gap-2 rounded-md px-1.5 py-1.5 ${off ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-slate-50"}`}>
                  <input type="checkbox" name={FIELD[g]} value={x.id} checked={checked} disabled={off} className="mt-0.5 shrink-0"
                    onChange={(e) => toggle(g, x.id, e.target.checked)} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm text-slate-800">{tplName(x)}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                      <span>{langName(x.lang)}</span>
                      {x.for === "any" && <><span aria-hidden>·</span><span>{forText("any", t)}</span></>}
                      {x.observation && <><span aria-hidden>·</span><span className="break-all">{"{{observation}}"}</span></>}
                    </span>
                    {why && (
                      <span className="mt-0.5 flex items-start gap-1 text-xs text-amber-700">
                        <Icon name="alert" size={12} className="mt-px shrink-0" /><span className="min-w-0">{why}</span>
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="mt-2"><Warn>{t(
            <>Koi template is group ke liye nahi hai. {toTemplates} mein kisi template ka group ‘{siteGroup(g === "site", t)}’ ya ‘Dono’ karo, ya upar doosra tareeka chuno.</>,
            <>No template fits this group. In {toTemplates} tag a template ‘{siteGroup(g === "site", t)}’ or ‘Both’, or choose another way above.</>,
          )}</Warn></div>
        )}
        <div className="mt-2 border-t border-slate-100 pt-2">
          {!list.length ? null : !on.length ? (
            noneInLang(g)
              ? <Warn>{t(
                <>Kam se kam 1 template tick karo. Is group ka koi template {langName(lang)} mein nahi likha hai, isliye kuch apne aap tick nahi hua: {toTemplates} mein {langName(lang)} mein ek likho, ya khud ek tick karo.</>,
                <>Tick at least 1 template. No template of this group is written in {langName(lang)}, so nothing was ticked for you: write one in {langName(lang)} in {toTemplates}, or tick one by hand.</>,
              )}</Warn>
              : <Warn>{t("Kam se kam 1 template tick karo.", "Tick at least 1 template.")}</Warn>
          ) : on.length === 1 ? (
            <Note>{t(`Is group ke sab leads ko ${tplNo(on[0])} jayega.`, `Every lead of this group gets ${tplNo(on[0])}.`)}</Note>
          ) : (
            <Note>{t(
              `Baari-baari se: ${[...on, on[0]].map(tplNo).join(" → ")} …`,
              `In turn: ${[...on, on[0]].map(tplNo).join(" → ")} …`,
            )}</Note>
          )}
        </div>
      </div>
    );
  };

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
          "Teen tareeke:\n• Website ke hisaab se templates: leads do groups mein bante hain. ‘Bina website’ = CSV mein koi website nahi, ya sirf Facebook, Instagram, Google Maps, directory, booking / delivery site, ya wixsite.com, eatbu.com jaise free builder page ka link. ‘Website hai’ = unki apni website. Har group ke liye 1–3 templates tick karo; group ke leads ko wo baari-baari se milte hain, taaki sabko bilkul ek jaisa text na jaye.\n• AI: har lead ke liye alag mail, sirf CSV mein di gayi sach details (business, contact, category, city, about, note) aur unki apni website ke title/description se. AI kabhi andaaza nahi lagata ki business kya karta hai, aur website ke design pe kabhi comment nahi karta.\n• Ek template sabko (Template 1–6): Settings → Email templates ka fixed text, har lead ko same.\nTemplates mein har lead ke liye {{business}}, {{contact}}, {{city}}, {{website}}, {{reviews}}, {{rating}}, {{observation}} jaise placeholders bharte hain, aur wo campaign ki bhasha mein likhe hone chahiye. {{observation}} kabhi apne aap nahi bharta: jis lead ki observation nahi hai, uski draft ‘Text chahiye’ mein aati hai aur wo hissa aap khud likhte ho. Jis lead ki file mein apna subject aur body hai, use wahi text jaata hai. Har mail same rules (60–110 words, ek sawaal, koi link nahi) se guzarti hai, aur har mail aap khud Approve page pe approve karte ho.",
          "Three ways:\n• Templates by website: the leads are split into two groups. ‘No website’ = no website in the CSV, or only a link to Facebook, Instagram, Google Maps, a directory, a booking / delivery site or a free builder page like wixsite.com or eatbu.com. ‘Has a website’ = a website of their own. Tick 1–3 templates per group; the leads of a group get them in turn, so not everyone gets identical text.\n• AI: a separate mail for each lead, written only from the true details in the CSV (business, contact, category, city, about, note) and the title/description of their own website. The AI never guesses what a business does and never comments on their website's design.\n• One template for everyone (Template 1–6): the fixed text from Settings → Email templates, the same for every lead.\nIn a template, placeholders like {{business}}, {{contact}}, {{city}}, {{website}}, {{reviews}}, {{rating}}, {{observation}} are filled in for each lead, and it must be written in the campaign's language. {{observation}} is never filled in by itself: a lead without one gets a ‘Needs your text’ draft and you write that part yourself. A lead with its own subject and body in the file gets that text. Every mail goes through the same rules (60–110 words, a question, no links), and you approve every mail yourself on the Approve page.",
        )}
          hint={bySite
            ? t(
              <>App har lead ki CSV wali website dekh ke uska group chunta hai, aur us group ke ticked templates mein se baari-baari se ek bharta hai. Har draft pe likha hota hai ki wo kis template se bani. Text {toTemplates} mein badlo; ticked templates {langName(lang)} mein likhe hone chahiye.</>,
              <>For every lead the app picks its group from the website in the CSV and fills the group&apos;s ticked templates in turn. Every draft shows which template it came from. Edit the texts in {toTemplates}; the ticked templates must be written in {langName(lang)}.</>,
            )
            : one
              ? t(
                <>Sabko same text jayega, sirf naam aur city jaisi details bharengi. Text {toTemplates} mein badlo; wo {langName(lang)} mein likha hona chahiye.</>,
                <>Everyone gets the same text; only details like the name and city are filled in. Edit it in {toTemplates}; it must be written in {langName(lang)}.</>,
              )
              : t("AI sirf CSV ki sach details use karta hai, aur unki website pe kabhi comment nahi karta.", "The AI uses only the true details from the CSV and never comments on their website.")}>
          <select name="mailType" className="input sm:max-w-[calc(50%-0.375rem)]" value={mailType} onChange={(e) => setMailType(e.target.value)}>
            <option value={BY_SITE}>{t("Website ke hisaab se templates", "Templates by website")}</option>
            <option value="ai">{t("AI har lead ke liye likhega", "AI writes each mail")}</option>
            {templates.map((x) => <option key={x.id} value={x.id}>{t(`Ek template sabko: ${tplName(x)}`, `One template for everyone: ${tplName(x)}`)}</option>)}
          </select>
        </Field>
        {/* only rendered (and so only submitted) for a "by website" campaign */}
        {bySite && (
          <div className="min-w-0 space-y-2 sm:col-span-2 lg:col-span-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{GROUPS.map(groupBox)}</div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <Note>{t(
                "Har group ke leads ko uske ticked templates baari-baari se milte hain (pehle lead ko pehla, doosre ko doosra, …), taaki sabko bilkul ek jaisa text na jaye.",
                "The leads of each group get its ticked templates in turn (the first lead the first one, the second lead the second, …), so not everyone gets identical text.",
              )}</Note>
              {(ownTicks.nosite || ownTicks.site) && (
                <button type="button" className="link shrink-0 self-start text-xs" onClick={() => setOwnTicks({})}>
                  {t("Sujhaye hue templates wapas lao", "Back to the suggested ticks")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <Note>{t(
            "Banane se koi mail nahi banti ya jaati. Agla step: campaign page pe ‘Campaign start karo’. Start se bhi koi mail approve nahi hoti: worker har Ready lead ka draft banata hai aur aap har mail Approve page pe khud approve karte ho. Chaho to start se pehle 5 sample drafts dekh lo.",
            "Creating it makes and sends no mail. Next step: ‘Start campaign’ on the campaign page. Starting approves nothing either: the worker makes a draft for every Ready lead and you approve every mail yourself on the Approve page. If you like, look at 5 sample drafts before starting.",
          )}</Note>
          {notes}
          {sel && sel.review > 0 && (
            <Warn>{t(
              `Is list ke ${sel.review} lead ‘Review chahiye’ mein hain. Unhe Ready leads khatam hone se pehle Contacts mein approve karo, warna campaign khatam ho jayega aur wo reh jayenge.`,
              `${sel.review} ${leads(sel.review)} of this list ${sel.review === 1 ? "is" : "are"} in ‘Needs review’. Approve them in Contacts before the Ready leads run out, otherwise the campaign ends and they are left out.`,
            )}</Warn>
          )}
          {warnings}
        </div>
        {/* a disabled fieldset disables the button inside it: no campaign while a "by website" group has no template ticked */}
        <fieldset disabled={blocked} className="min-w-0 shrink-0">
          <SubmitButton icon="plus" pendingText={t("Ban raha hai…", "Creating…")} className="btn-primary w-full sm:w-auto">{t("Campaign banao", "Create campaign")}</SubmitButton>
        </fieldset>
      </div>
    </form>
  );
}
