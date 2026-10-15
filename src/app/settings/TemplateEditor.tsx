"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Field } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Info } from "@/components/Info";
import { useT } from "@/components/lang";
import { LANGS } from "@/lib/lang";
import type { TemplateId } from "@/lib/templates";
import { EXAMPLE_LEAD, ruleText, tryTemplate } from "./template-check";

type Tpl = { id: TemplateId; name: string; subject: string; body: string };
type Key = "name" | "subject" | "body";

const SUBHEAD = "flex min-w-0 items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400";
const OK_CHIP = "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
const BAD_CHIP = "bg-amber-50 text-amber-700 ring-amber-600/20";
// these three rules have their own chip; every other broken rule is listed in words below them
const CHIP_RULES = /^(body has \d+ words|no question as call to action|link in body)/;

/** "tpl1" + "body" → "tpl1Body": the Settings field the form saves. */
const fieldName = (id: TemplateId, k: Key) => `${id}${k[0].toUpperCase()}${k.slice(1)}`;

function Chip({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <li className={`badge ${ok === undefined ? "" : ok ? OK_CHIP : BAD_CHIP}`}>
      {ok !== undefined && <Icon name={ok ? "check" : "alert"} size={11} strokeWidth={2.4} />}{children}
    </li>
  );
}

/**
 * Settings → Email templates. The fields are plain fields of the settings form (saved with "Settings save karo").
 * One template is open at a time; the others stay in the form, hidden, so all three are always saved.
 * The preview fills the typed text with an example lead and runs the same rules every draft must pass.
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
  const results = vals.map((x) => tryTemplate(x.subject, x.body, me, full));
  const lead = full
    ? [EXAMPLE_LEAD.businessName, EXAMPLE_LEAD.contactName, EXAMPLE_LEAD.city, EXAMPLE_LEAD.category, EXAMPLE_LEAD.country].join(" · ")
    : t(`${EXAMPLE_LEAD.businessName} (baaki details khaali)`, `${EXAMPLE_LEAD.businessName} (no other details)`);

  return (
    <div ref={box} className="space-y-4">
      <div role="tablist" aria-label="Templates" className="seg max-sm:grid max-sm:w-full max-sm:grid-cols-3">
        {vals.map((x, i) => (
          <button key={x.id} type="button" role="tab" id={`${x.id}-tab`} aria-controls={`${x.id}-panel`} aria-selected={open === x.id}
            onClick={() => setOpen(x.id)} className={`seg-item justify-center ${open === x.id ? "seg-item-on" : ""}`}>
            <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${results[i].ok ? "bg-emerald-500" : "bg-amber-500"}`} />
            Template {i + 1}
            {x.name.trim() && <span className="hidden max-w-[11rem] truncate font-normal text-slate-400 sm:inline">{x.name}</span>}
            <span className="sr-only">{results[i].ok ? t("(rules theek)", "(rules OK)") : t("(rules fail)", "(rules fail)")}</span>
          </button>
        ))}
      </div>

      {vals.map((x, i) => {
        const r = results[i];
        const lang = LANGS[r.lang] || r.lang.toUpperCase();
        const others = r.errors.filter((e) => !CHIP_RULES.test(e));
        return (
          <div key={x.id} role="tabpanel" id={`${x.id}-panel`} aria-labelledby={`${x.id}-tab`} hidden={open !== x.id}
            className={open === x.id ? "grid gap-x-6 gap-y-5 lg:grid-cols-2" : "hidden"}>
            <div className="min-w-0 space-y-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <Field label={t("Template ka naam", "Template name")} info={t(
                  `Sirf aapke pehchanne ke liye. Campaign banate waqt ‘Mail kaise banegi’ list mein ‘Template ${i + 1}: naam’ dikhta hai. Lead ko ye naam kabhi nahi dikhta.`,
                  `Only for you to recognise it. When you create a campaign, ‘How mails are written’ lists it as ‘Template ${i + 1}: name’. Leads never see this name.`,
                )}>
                  <input name={fieldName(x.id, "name")} defaultValue={x.name} onChange={(e) => set(x.id, "name", e.target.value)} className="input" />
                </Field>
                <Field label="Subject" info={t(
                  "Mail ka subject. Placeholders yahan bhi chalte hain, jaise {{business}}. 90 akshar tak, aur ‘Re:’ ya ‘Fwd:’ se shuru nahi ho sakta.",
                  "The mail's subject. Placeholders work here too, e.g. {{business}}. Up to 90 characters, and it cannot start with ‘Re:’ or ‘Fwd:’.",
                )}>
                  <input name={fieldName(x.id, "subject")} defaultValue={x.subject} onChange={(e) => set(x.id, "subject", e.target.value)} className="input" />
                </Field>
              </div>
              <Field label={t("Mail ka text", "Mail text")} info={t(
                "Greeting se aakhri sawaal tak poori mail, bina signature ke. Har lead ke liye placeholders bharte hain. Signature aur footer (address kahan se mila, STOP wali line, postal address) app khud neeche lagata hai. Campaign ki bhasha mein likho: English campaign ke liye English, French ke liye French.",
                "The whole mail from the greeting to the closing question, without a signature. The placeholders are filled in for each lead. The app adds the signature and footer (where the address was found, the STOP line, postal address) below it by itself. Write it in the campaign's language: English for an English campaign, French for a French one.",
              )} hint={t("60–110 words · aakhir mein ek sawaal (?) · koi link nahi", "60–110 words · end with a question (?) · no links")}>
                <textarea name={fieldName(x.id, "body")} defaultValue={x.body} onChange={(e) => set(x.id, "body", e.target.value)} rows={11} className="input" />
              </Field>
            </div>

            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className={SUBHEAD}>
                  <Icon name="eye" size={12} />Preview
                  <Info title="Preview" size={12} text={t(
                    "Aapka likha text, ek example lead ke saath bhara hua: lead ko bilkul aisi hi mail jaati hai, neeche signature aur footer ke saath. Typing ke saath badalta hai. ‘Sirf business naam’ dabao to dikhega ki contact, city ya category khaali hone pe {{x|text}} wala text kaise aata hai. Neeche wahi rules check hote hain jo har draft ko pass karne hote hain.",
                    "Your text filled in with an example lead: the lead gets exactly this mail, with the signature and footer below it. It changes as you type. Press ‘Business name only’ to see how the {{x|text}} text shows when contact, city or category are empty. Below it, the same rules are checked that every draft has to pass.",
                  )} />
                </span>
                <div role="group" aria-label={t("Example lead", "Example lead")} className="seg">
                  <button type="button" aria-pressed={full} onClick={() => setFull(true)} className={`seg-item ${full ? "seg-item-on" : ""}`}>{t("Poori details", "All details")}</button>
                  <button type="button" aria-pressed={!full} onClick={() => setFull(false)} className={`seg-item ${!full ? "seg-item-on" : ""}`}>{t("Sirf business naam", "Business name only")}</button>
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-900">{r.subject || <span className="font-normal text-slate-400">{t("(subject nahi hai)", "(no subject)")}</span>}</div>
                <pre className="whitespace-pre-wrap break-words px-3 py-2.5 font-sans text-sm leading-relaxed text-slate-700">{r.body || <span className="text-slate-400">{t("(text khaali hai)", "(no text)")}</span>}</pre>
                <div className="flex items-center gap-1.5 border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-2xs text-slate-400">
                  <Icon name="plus" size={11} />{t("Signature aur footer apne aap neeche lagte hain", "The signature and footer are added below automatically")}
                </div>
              </div>
              <p className="mt-1.5 break-words text-2xs text-slate-400">{t("Example lead", "Example lead")}: {lead}</p>

              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("Rules check", "Rules check")}>
                <Chip ok={r.words >= 60 && r.words <= 110}>{r.words} words (60–110)</Chip>
                <Chip ok={!r.errors.includes("no question as call to action")}>{t("Sawaal (?)", "Question (?)")}</Chip>
                <Chip ok={!r.errors.some((e) => e.startsWith("link in body"))}>{t("Koi link nahi", "No links")}</Chip>
                <Chip>{t("Bhasha", "Language")}: {lang}</Chip>
              </ul>
              {(others.length > 0 || r.unknown.length > 0) && (
                <ul className="mt-2 space-y-1 text-xs text-amber-700">
                  {others.map((e) => <li key={e} className="flex items-start gap-1.5"><Icon name="alert" size={12} className="mt-0.5 shrink-0" />{ruleText(e, t)}</li>)}
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
              <p className={`mt-2.5 flex items-start gap-1.5 text-xs ${r.ok ? "text-emerald-700" : "text-amber-700"}`}>
                <Icon name={r.ok ? "check-circle" : "alert"} size={13} className="mt-px shrink-0" />
                <span>{r.ok
                  ? t(`Rules pass hain. Sirf ${lang} campaign ke saath use karo: dusri bhasha ke campaign mein draft fail hoga.`, `Passes the rules. Use it only with campaigns in ${lang}: in a campaign in another language the drafts fail.`)
                  : t("Is text se drafts fail honge. Upar ki baatein theek karo, phir Settings save karo.", "Drafts made from this text will fail. Fix the points above, then save the settings.")}</span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
