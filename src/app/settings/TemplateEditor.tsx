"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Field } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Info } from "@/components/Info";
import { useT } from "@/components/lang";
import { forChip, forText } from "@/components/siteText";
import { LANGS } from "@/lib/lang";
import { MAX_PER_GROUP, missingMark, toTemplateFor, tplNo, type Group, type TemplateFor, type TemplateId } from "@/lib/templates";
import { EXAMPLE_LEAD, EXAMPLE_NOSITE_OBSERVATION, EXAMPLE_SITE, ruleText, tryTemplate } from "./template-check";

type Tpl = { id: TemplateId; name: string; subject: string; body: string; for: TemplateFor; lang: string };
type Key = "name" | "subject" | "body" | "for" | "lang";

const SUBHEAD = "flex min-w-0 items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400";
const OK_CHIP = "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
const BAD_CHIP = "bg-amber-50 text-amber-700 ring-amber-600/20";
// these rules have their own chip; every other broken rule is listed in words below them
const CHIP_RULES = /^(body has \d+ words|no question as call to action|link in body)/;
// the Group tag: grey for both groups, violet for "Bina website", sky for "Website hai"
const FOR_CHIP: Record<TemplateFor, string> = { any: "bg-slate-100 text-slate-500", nosite: "bg-violet-50 text-violet-700", site: "bg-sky-50 text-sky-700" };
// the Group select lists the two groups first, then "Dono groups"
const GROUP_OPTIONS: TemplateFor[] = ["nosite", "site", "any"];
const GROUPS: Group[] = ["nosite", "site"];
// {{website}} / {{observation}} with or without a {{x|text}} default
const SITE_VAR = /\{\{\s*website\s*(?:\|[^}]*)?\}\}/i;
const OBS_VAR = /\{\{\s*observation\s*(?:\|[^}]*)?\}\}/i;

/** "tpl1" + "body" → "tpl1Body": the Settings field the form saves. */
const fieldName = (id: TemplateId, k: Key) => `${id}${k[0].toUpperCase()}${k.slice(1)}`;
const langName = (l: string) => LANGS[l] || l.toUpperCase();

function Chip({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <li className={`badge ${ok === undefined ? "" : ok ? OK_CHIP : BAD_CHIP}`}>
      {ok !== undefined && <Icon name={ok ? "check" : "alert"} size={11} strokeWidth={2.4} />}{children}
    </li>
  );
}

/** The template's group as a tiny chip: "Bina website" / "Website hai" / "Dono". */
function ForChip({ f }: { f: TemplateFor }) {
  const { t } = useT();
  return <span className={`inline-flex h-4 shrink-0 items-center rounded px-1 text-2xs font-semibold ${FOR_CHIP[f]}`}>{forChip(f, t)}</span>;
}

/** The text with every [OBSERVATION] mark (a detail the draft waits for) highlighted. */
function Marked({ text, marks }: { text: string; marks: string[] }) {
  if (!marks.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${marks.map((m) => m.replace(/[[\]]/g, "\\$&")).join("|")})`));
  return <>{parts.map((p, i) => (marks.includes(p) ? <mark key={i} className="rounded bg-amber-100 px-0.5 font-semibold text-amber-800">{p}</mark> : p))}</>;
}

/**
 * Settings → Email templates. The fields are plain fields of the settings form (saved with "Settings save karo").
 * One template is open at a time; the others stay in the form, hidden, so all six are always saved.
 * The preview fills the typed text with an example lead and runs the same rules every draft must pass, against the
 * template's set language (or the one read from its text). A "Website hai" template is previewed with an example lead
 * that has a website ({{website}} filled). Above the tabs: how many templates each group has, per language.
 */
export function TemplateEditor({ templates, senderName, business }: { templates: Tpl[]; senderName: string; business: string }) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  const [vals, setVals] = useState(templates);
  const [open, setOpen] = useState<TemplateId>(templates[0]?.id ?? "tpl1");
  const [full, setFull] = useState(true);
  const [me, setMe] = useState({ senderName, business });

  // {{my_name}} and {{my_business}} follow the Name and Business fields of the same form, also before saving
  useEffect(() => {
    const form = box.current?.closest("form");
    if (!form) return;
    const read = () => {
      const v = (n: string) => { const el = form.elements.namedItem(n); return el instanceof HTMLInputElement ? el.value : ""; };
      const next = { senderName: v("senderName"), business: v("business") };
      setMe((m) => (m.senderName === next.senderName && m.business === next.business ? m : next));
    };
    form.addEventListener("input", read);
    return () => form.removeEventListener("input", read);
  }, []);

  const set = (id: TemplateId, k: Key, v: string) => setVals((xs) => xs.map((x) => (x.id === id ? { ...x, [k]: v } : x)));
  const results = vals.map((x) => tryTemplate(x.subject, x.body, me, full, x.for === "site", x.lang));
  // per group: the templates that fit it (its own + "Dono groups"), counted per language, since a campaign has one language
  const groups = GROUPS.map((g) => {
    const byLang = new Map<string, number>();
    vals.forEach((x, i) => { if (x.for === g || x.for === "any") byLang.set(results[i].lang, (byLang.get(results[i].lang) || 0) + 1); });
    const langs = [...byLang].sort((a, b) => b[1] - a[1]);
    return { g, n: langs.reduce((a, [, k]) => a + k, 0), langs, over: langs.filter(([, k]) => k > MAX_PER_GROUP).map(([l]) => langName(l)) };
  });
  /** The "Example lead" line under the preview; a "Website hai" template's lead has a website. */
  const leadLine = (site: boolean) => {
    const web = site ? EXAMPLE_SITE : t("website nahi", "no website");
    return full
      ? [EXAMPLE_LEAD.businessName, EXAMPLE_LEAD.contactName, EXAMPLE_LEAD.city, EXAMPLE_LEAD.category, EXAMPLE_LEAD.country, web,
        `${EXAMPLE_LEAD.reviews} Google reviews`, `rating ${EXAMPLE_LEAD.rating}`].join(" · ")
      : site
        ? t(`${EXAMPLE_LEAD.businessName} · ${EXAMPLE_SITE} (baaki details aur observation khaali)`, `${EXAMPLE_LEAD.businessName} · ${EXAMPLE_SITE} (no other details, no observation)`)
        : t(`${EXAMPLE_LEAD.businessName} (baaki details aur observation khaali)`, `${EXAMPLE_LEAD.businessName} (no other details, no observation)`);
  };

  return (
    <div ref={box} className="space-y-4">
      {/* how many templates each group has: a "by website" campaign ticks up to 3 per group, all in its own language */}
      <div className="min-w-0">
        <div className={`${SUBHEAD} mb-2`}>
          <Icon name="globe" size={12} />{t("Har group ke templates", "Templates per group")}
          <Info title={t("Har group ke templates", "Templates per group")} size={12} text={t(
            `‘Website ke hisaab se templates’ wale campaign mein har group ke 1 se ${MAX_PER_GROUP} templates tick hote hain, aur us group ke leads ko wo baari baari (ek ke baad ek) milte hain. ‘Dono groups’ wala template dono groups mein ginta hai. Ginti bhasha ke hisaab se hai, kyunki ek campaign ek hi bhasha ka hota hai: campaign form sirf campaign ki bhasha wale templates pehle se tick karta hai (group ke apne, warna ‘Dono groups’ wale), aur us bhasha mein koi na ho to kuch tick nahi hota. Ye ginti abhi ke likhe text se hai, save se pehle bhi.`,
            `A ‘Templates by website’ campaign ticks 1 to ${MAX_PER_GROUP} templates per group, and the leads of that group get them in turn (one after another). A ‘Both groups’ template counts in both groups. The count is per language, since a campaign has one language: the campaign form pre-ticks only templates in the campaign's language (the group's own, else the ‘Both groups’ ones), and nothing if none is in that language. It follows the text as typed, also before saving.`,
          )} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {groups.map(({ g, n, langs, over }) => (
            <div key={g} className={`min-w-0 rounded-lg px-3 py-2 text-xs ring-1 ring-inset ${over.length || !n ? "bg-amber-50/70 ring-amber-200" : "bg-slate-50/70 ring-slate-200/70"}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <ForChip f={g} />
                <span className="font-semibold tabular-nums text-slate-800">{n} templates</span>
                {langs.length > 0 && <span className="min-w-0 break-words text-slate-500">{langs.map(([l, k]) => `${langName(l)} ${k}`).join(" · ")}</span>}
              </div>
              {over.length > 0 && (
                <p className="mt-1 flex items-start gap-1.5 text-amber-700">
                  <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 break-words">{t(
                    `${over.join(", ")} mein ${MAX_PER_GROUP} se zyada hain: ek campaign mein ek group ke ${MAX_PER_GROUP} tak tick hote hain, baaki us campaign mein nahi lagenge.`,
                    `More than ${MAX_PER_GROUP} in ${over.join(", ")}: a campaign ticks up to ${MAX_PER_GROUP} per group, the others are not used in that campaign.`,
                  )}</span>
                </p>
              )}
              {!n && (
                <p className="mt-1 flex items-start gap-1.5 text-amber-700">
                  <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 break-words">{t(
                    `Is group ke liye koi template nahi. Kisi template ka Group ‘${forChip(g, t)}’ ya ‘Dono groups’ rakho.`,
                    `No template for this group. Set a template's Group to ‘${forChip(g, t)}’ or ‘Both groups’.`,
                  )}</span>
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* six tabs in 3 columns, two rows: up to md the group and language sit under "Template N"; wider, one line, and the name from xl */}
      <div role="tablist" aria-label="Templates" className="seg grid w-full grid-cols-3">
        {vals.map((x, i) => (
          <button key={x.id} type="button" role="tab" id={`${x.id}-tab`} aria-controls={`${x.id}-panel`} aria-selected={open === x.id}
            onClick={() => setOpen(x.id)}
            className={`seg-item min-w-0 justify-center max-md:h-auto max-md:flex-col max-md:gap-1 max-md:px-1 max-md:py-1.5 xl:justify-start ${open === x.id ? "seg-item-on" : ""}`}>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${results[i].ok ? "bg-emerald-500" : "bg-amber-500"}`} />
              {tplNo(x.id)}
            </span>
            <span className="inline-flex items-center gap-1">
              <ForChip f={x.for} />
              <span className="text-2xs font-semibold uppercase text-slate-400">{results[i].lang}</span>
            </span>
            {x.name.trim() && <span className="hidden min-w-0 truncate font-normal text-slate-400 xl:inline">{x.name}</span>}
            <span className="sr-only">{results[i].ok ? t("(rules theek)", "(rules OK)") : t("(rules fail)", "(rules fail)")}</span>
          </button>
        ))}
      </div>

      {vals.map((x, i) => {
        const r = results[i];
        const lang = langName(r.lang);
        const others = r.errors.filter((e) => !CHIP_RULES.test(e));
        const marks = r.missing.map(missingMark);
        // the words around a missing detail (each mark counts as one word in r.words)
        const around = r.words - marks.reduce((a, m) => a + r.body.split(m).length - 1, 0);
        const usesObs = OBS_VAR.test(`${x.subject}\n${x.body}`);
        // {{website}} is only filled for leads with a website of their own
        const siteNote = SITE_VAR.test(`${x.subject}\n${x.body}`) && x.for !== "site"
          ? x.for === "nosite"
            ? t(
              "{{website}} sirf ‘Website hai’ group ke leads ke liye bharta hai. Ye template ‘Bina website’ group ka hai, isliye yahan ye aam taur pe khaali (ya default text) rahega; par agar koi campaign ise website wale leads ko bhi bheje (ek template sabko, ya ‘Website hai’ group mein tick), to unki website bhar jayegi. Ise hata do.",
              "{{website}} is only filled for leads in the ‘Has a website’ group. This template is in the ‘No website’ group, so here it normally stays empty (or shows its default); but if a campaign also sends it to leads with a website (one template for everyone, or ticked in the ‘Has a website’ group), their domain is filled in. Better remove it.",
            )
            : t(
              "‘Dono groups’ wale template mein {{website}} sirf ‘Website hai’ group ke leads ke liye bharta hai, baaki ke liye khaali (ya default text) rehta hai. Unki website ki baat karni hai to Group ‘Website hai’ chuno.",
              "In a ‘Both groups’ template, {{website}} is only filled for leads in the ‘Has a website’ group; for the others it stays empty (or shows its default). To talk about their website, set the Group to ‘Has a website’.",
            )
          : null;
        return (
          <div key={x.id} role="tabpanel" id={`${x.id}-panel`} aria-labelledby={`${x.id}-tab`} hidden={open !== x.id}
            className={open === x.id ? "grid gap-x-6 gap-y-5 lg:grid-cols-2" : "hidden"}>
            <div className="min-w-0 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field className="sm:col-span-2" label={t("Template ka naam", "Template name")} info={t(
                  `Sirf aapke pehchanne ke liye. Campaign banate waqt ‘Mail kaise banegi’ list mein ‘${tplNo(x.id)}: naam’ dikhta hai, aur har draft pe bhi likha hota hai ki wo kis template se bana. Lead ko ye naam kabhi nahi dikhta.`,
                  `Only for you to recognise it. When you create a campaign, ‘How mails are written’ lists it as ‘${tplNo(x.id)}: name’, and every draft shows which template it was made from. Leads never see this name.`,
                )}>
                  <input name={fieldName(x.id, "name")} defaultValue={x.name} onChange={(e) => set(x.id, "name", e.target.value)} className="input" />
                </Field>
                <Field label="Group" info={t(
                  `Ye template kis group ke leads ke liye likha hai. ‘Bina website’: jinki apni website nahi hai (CSV mein khaali, ya sirf Facebook, Instagram, Google Maps, directory, booking ya delivery site ka link, ya wixsite.com, eatbu.com jaisa free / temporary builder page). ‘Website hai’: jinki apni website hai. ‘Dono groups’: dono mein chal jaata hai. ‘Website ke hisaab se templates’ wale campaign mein har group ke 1 se ${MAX_PER_GROUP} templates tick hote hain; campaign form isi Group se templates pehle se tick karta hai, sirf campaign ki bhasha wale (group ke apne, warna ‘Dono groups’ wale; us bhasha mein koi na ho to kuch nahi). ‘Website hai’ chuno to preview ki example lead ki bhi website hoti hai.`,
                  `Which group of leads this template is written for. ‘No website’: leads without a website of their own (empty in the CSV, or only a Facebook, Instagram, Google Maps, directory, booking or delivery link, or a free / temporary builder page like wixsite.com or eatbu.com). ‘Has a website’: leads with one. ‘Both groups’: fits either. A ‘Templates by website’ campaign ticks 1 to ${MAX_PER_GROUP} templates per group; the campaign form pre-ticks them by this Group, only those in the campaign's language (the group's own, else the ‘Both groups’ ones; none if none is in that language). With ‘Has a website’, the preview's example lead has a website too.`,
                )}>
                  <select name={fieldName(x.id, "for")} defaultValue={x.for} onChange={(e) => set(x.id, "for", toTemplateFor(e.target.value))} className="input">
                    {GROUP_OPTIONS.map((f) => <option key={f} value={f}>{forText(f, t)}</option>)}
                  </select>
                </Field>
                <Field label={t("Bhasha", "Language")} info={t(
                  "Ye template kis bhasha mein likha hai. ‘Text se apne aap’ = app text padh ke bhasha pehchanta hai. Campaign form sirf campaign ki bhasha wale templates pehle se tick karta hai, doosri bhasha wale kabhi nahi. Mail hamesha campaign ki bhasha mein honi chahiye: French campaign ke liye French text, warna draft ‘Text chahiye’ mein rukta hai.",
                  "The language this template is written in. ‘Auto from the text’ = the app reads the text and recognises the language. The campaign form pre-ticks only templates in the campaign's language, never ones in another language. A mail must always be in the campaign's language: French text for a French campaign, otherwise the draft waits as ‘Needs your text’.",
                )}>
                  <select name={fieldName(x.id, "lang")} defaultValue={x.lang} onChange={(e) => set(x.id, "lang", e.target.value)} className="input">
                    <option value="">{t(`Text se apne aap (${langName(r.textLang)})`, `Auto from the text (${langName(r.textLang)})`)}</option>
                    {Object.entries(LANGS).map(([k, name]) => <option key={k} value={k}>{name}</option>)}
                  </select>
                </Field>
                <Field className="sm:col-span-2" label="Subject" info={t(
                  "Mail ka subject. Placeholders yahan bhi chalte hain, jaise {{business}}. 90 akshar tak, aur ‘Re:’ ya ‘Fwd:’ se shuru nahi ho sakta.",
                  "The mail's subject. Placeholders work here too, e.g. {{business}}. Up to 90 characters, and it cannot start with ‘Re:’ or ‘Fwd:’.",
                )}>
                  <input name={fieldName(x.id, "subject")} defaultValue={x.subject} onChange={(e) => set(x.id, "subject", e.target.value)} className="input" />
                </Field>
              </div>
              <Field label={t("Mail ka text", "Mail text")} info={t(
                "Greeting se aakhri sawaal tak poori mail, bina signature ke. Har lead ke liye placeholders bharte hain. Signature aur footer (address kahan se mila, STOP wali line, postal address) app khud neeche lagata hai. Campaign ki bhasha mein likho (aur upar ‘Bhasha’ wahi rakho): English campaign ke liye English, French ke liye French.",
                "The whole mail from the greeting to the closing question, without a signature. The placeholders are filled in for each lead. The app adds the signature and footer (where the address was found, the STOP line, postal address) below it by itself. Write it in the campaign's language (and keep ‘Language’ above the same): English for an English campaign, French for a French one.",
              )} hint={t("60–110 words · aakhir mein ek sawaal (?) · koi link nahi", "60–110 words · end with a question (?) · no links")}>
                <textarea name={fieldName(x.id, "body")} defaultValue={x.body} onChange={(e) => set(x.id, "body", e.target.value)} rows={11} className="input" />
              </Field>
            </div>

            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className={SUBHEAD}>
                  <Icon name="eye" size={12} />Preview
                  <Info title="Preview" size={12} text={t(
                    `Aapka likha text, ek example lead ke saath bhara hua: lead ko bilkul aisi hi mail jaati hai, neeche signature aur footer ke saath. Typing ke saath badalta hai. ‘Poori details’ wali lead ke ${EXAMPLE_LEAD.reviews} Google reviews hain, rating ${EXAMPLE_LEAD.rating}, aur ek observation bhi. ‘Sirf business naam’ dabao to dikhega ki contact, city ya category khaali hone pe {{x|text}} wala text kaise aata hai, aur observation na ho to draft mein [OBSERVATION] aata hai. ‘Website hai’ group wale template ki example lead ki website ${EXAMPLE_SITE} hai ({{website}} isi se bharta hai); baaki templates mein lead ki koi website nahi. Neeche wahi rules check hote hain jo har draft ko pass karne hote hain.`,
                    `Your text filled in with an example lead: the lead gets exactly this mail, with the signature and footer below it. It changes as you type. The ‘All details’ lead has ${EXAMPLE_LEAD.reviews} Google reviews, a ${EXAMPLE_LEAD.rating} rating and an observation. Press ‘Business name only’ to see how the {{x|text}} text shows when contact, city or category are empty, and how a draft without an observation shows [OBSERVATION]. For a ‘Has a website’ template the example lead's website is ${EXAMPLE_SITE} ({{website}} is filled with it); in the other templates the lead has no website. Below it, the same rules are checked that every draft has to pass.`,
                  )} />
                </span>
                <div role="group" aria-label={t("Example lead", "Example lead")} className="seg">
                  <button type="button" aria-pressed={full} onClick={() => setFull(true)} className={`seg-item ${full ? "seg-item-on" : ""}`}>{t("Poori details", "All details")}</button>
                  <button type="button" aria-pressed={!full} onClick={() => setFull(false)} className={`seg-item ${!full ? "seg-item-on" : ""}`}>{t("Sirf business naam", "Business name only")}</button>
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="break-words border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-900">{r.subject ? <Marked text={r.subject} marks={marks} /> : <span className="font-normal text-slate-400">{t("(subject nahi hai)", "(no subject)")}</span>}</div>
                <pre className="whitespace-pre-wrap break-words px-3 py-2.5 font-sans text-sm leading-relaxed text-slate-700">{r.body ? <Marked text={r.body} marks={marks} /> : <span className="text-slate-400">{t("(text khaali hai)", "(no text)")}</span>}</pre>
                <div className="flex items-center gap-1.5 border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-2xs text-slate-400">
                  <Icon name="plus" size={11} />{t("Signature aur footer apne aap neeche lagte hain", "The signature and footer are added below automatically")}
                </div>
              </div>
              <div className="mt-1.5 space-y-0.5 break-words text-2xs text-slate-400">
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <ForChip f={x.for} />
                  <span className="min-w-0 break-words">{t("Example lead", "Example lead")}: {leadLine(x.for === "site")}</span>
                </p>
                {full && <p className="min-w-0 break-words">Observation: “{x.for === "site" ? EXAMPLE_LEAD.observation : EXAMPLE_NOSITE_OBSERVATION}”</p>}
              </div>

              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("Rules check", "Rules check")}>
                {r.missing.length
                  ? <Chip>{t(`${around} words + aapka text`, `${around} words + your text`)}</Chip>
                  : <Chip ok={r.words >= 60 && r.words <= 110}>{r.words} words (60–110)</Chip>}
                <Chip ok={!r.errors.includes("no question as call to action")}>{t("Sawaal (?)", "Question (?)")}</Chip>
                <Chip ok={!r.errors.some((e) => e.startsWith("link in body"))}>{t("Koi link nahi", "No links")}</Chip>
                <Chip ok={x.lang ? x.lang === r.textLang : undefined}>
                  {t("Bhasha", "Language")}: {lang}{!x.lang && <span className="font-normal opacity-70">&nbsp;{t("(text se)", "(from the text)")}</span>}
                </Chip>
              </ul>
              {(others.length > 0 || r.unknown.length > 0) && (
                <ul className="mt-2 space-y-1 text-xs text-amber-700">
                  {others.map((e) => <li key={e} className="flex items-start gap-1.5"><Icon name="alert" size={12} className="mt-0.5 shrink-0" /><span className="min-w-0 break-words">{ruleText(e, t)}</span></li>)}
                  {r.unknown.map((k) => (
                    <li key={k} className="flex items-start gap-1.5"><Icon name="alert" size={12} className="mt-0.5 shrink-0" />
                      <span className="min-w-0 break-words">{t(
                        `{{${k}}} koi placeholder nahi hai, isliye khaali reh jayega. Upar ki list wala naam likho.`,
                        `{{${k}}} is not a known placeholder, so it stays empty. Use a name from the list above.`,
                      )}</span>
                    </li>
                  ))}
                </ul>
              )}
              {usesObs && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-600">
                  <Icon name="info" size={12} className="mt-0.5 shrink-0 text-slate-400" />
                  <span className="min-w-0 break-words">{r.missing.length
                    ? t(
                      <><b className="font-semibold text-slate-800">Text chahiye:</b> in leads ke liye draft aapke text ka wait karega. Jis lead ka CSV mein observation nahi hai, uske draft mein [OBSERVATION] aata hai aur wo ‘Text chahiye’ mein rukta hai: Approve page pe ‘Text edit karo’ se wahan apni baat likho aur save karo, tabhi approve hoga. {"{{observation|text}}"} ka default text kabhi nahi lagta.</>,
                      <><b className="font-semibold text-slate-800">Needs your text:</b> for these leads the draft waits for your text. A lead without an observation in the CSV gets [OBSERVATION] in its draft, and the draft waits as ‘Needs your text’: on the Approve page, use ‘Edit text’ to write your own words there and save; only then can it be approved. A {"{{observation|text}}"} default is never used.</>,
                    )
                    : t(
                      "Is template mein {{observation}} hai: jin leads ka CSV mein observation nahi, unka draft ‘Text chahiye’ mein rukega jab tak aap wo hissa khud na likho. ‘Sirf business naam’ dabao to dekho.",
                      "This template uses {{observation}}: leads without an observation in the CSV get a draft that waits as ‘Needs your text’ until you write that part yourself. Press ‘Business name only’ to see it.",
                    )}</span>
                </p>
              )}
              {siteNote && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-600">
                  <Icon name="info" size={12} className="mt-0.5 shrink-0 text-slate-400" /><span className="min-w-0 break-words">{siteNote}</span>
                </p>
              )}
              <p className={`mt-2.5 flex items-start gap-1.5 text-xs ${r.ok ? "text-emerald-700" : "text-amber-700"}`}>
                <Icon name={r.ok ? "check-circle" : "alert"} size={13} className="mt-px shrink-0" />
                <span className="min-w-0 break-words">{!r.ok
                  ? t("Is text mein galti hai: jo draft niyam todegi wo ‘Text chahiye’ mein rukegi, aur har ek ko Text edit se theek karna padega. Upar ki baatein theek karo, phir Settings save karo.", "This text has problems: drafts that break a rule wait as ‘Needs your text’, each to be fixed with Edit text. Fix the points above, then save the settings.")
                  : r.missing.length
                    ? t(
                      `Baaki rules pass hain. Aapka text likhne ke baad poori mail (60–110 words bhi) dobara check hoti hai. Sirf ${lang} campaign ke saath use karo.`,
                      `The other rules pass. Once you write your text, the whole mail (60–110 words too) is checked again. Use it only with campaigns in ${lang}.`,
                    )
                    : t(`Rules pass hain. Sirf ${lang} campaign ke saath use karo: dusri bhasha ke campaign mein draft ‘Text chahiye’ mein rukegi.`, `Passes the rules. Use it only with campaigns in ${lang}: in a campaign in another language the drafts wait as ‘Needs your text’.`)}</span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
