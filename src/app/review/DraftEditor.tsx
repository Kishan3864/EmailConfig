"use client";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { LANGS } from "@/lib/lang";
import { Icon } from "@/components/icons";
import { Info } from "@/components/Info";
import { useT } from "@/components/lang";
import { friendlyError, useToast } from "@/components/toast";
import { Field } from "@/components/ui";
import { saveDraftEdit } from "../actions";

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

// Copies of a few cheap rules from lib/validate.ts, so the panel warns while typing. Save runs the full check on the server.
const OK_CAPS = new Set(["HTTPS", "HTTP", "HTML", "SEO", "URL", "WWW", "SMS", "PDF", "FAQ", "TVA", "SIRET", "RGPD", "GDPR", "CMS", "UX", "UI", "STOP", "OK", "CEO", "PME", "TPE", "SARL", "SAS", "SASU", "EURL", "GMBH", "LLC", "LTD"]);
const FAKE_REPLY = /^\s*(re|fwd?|tr|aw|wg|rv)\s*:/i;
const DOUBLE_PUNCT = /!!|\?\?/;
const LINK = /https?:\/\/|www\./i;

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className={`flex items-start gap-2 text-xs font-medium ${ok ? "text-emerald-700" : "text-amber-700"}`}>
      <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${ok ? "bg-emerald-100" : "bg-amber-100"}`}>
        <Icon name={ok ? "check" : "alert"} size={10} strokeWidth={2.6} />
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

/**
 * Edit a draft by hand. The edit is checked by the same rules as an AI draft and must be approved again.
 * Renders the "Text edit karo" / "Edit text" button and, when open, the form (order-last puts it below the card's buttons).
 */
export function DraftEditor({ id, subject, body, language, businessName = "" }: { id: string; subject: string; body: string; language: string; businessName?: string }) {
  const toast = useToast();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [subj, setSubj] = useState(subject);
  const [text, setText] = useState(body);
  const [pending, start] = useTransition();

  const toggle = () => { setSubj(subject); setText(body); setOpen(!open); };
  // onSubmit (not a form action) so the typed text stays in the fields when the check fails
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    start(async () => {
      try {
        // a failed check comes back as "Error: Edit save nahi hua\n• reason…" (or the English version): the toast shows the first line as its title
        const failed = toast.result(await saveDraftEdit(id, fd), { okTitle: t("Edit save ho gaya", "Edit saved") });
        if (!failed) setOpen(false);
      } catch (err) {
        toast.error(t("Edit save nahi hua", "Edit not saved"), friendlyError(err, t));
      }
    });
  };

  const words = countWords(text);
  const wordsOk = words >= 60 && words <= 110;
  const hasQuestion = text.includes("?");
  const noLink = !LINK.test(subj) && !LINK.test(text);
  const subjLen = subj.trim().length;
  const fakeReply = FAKE_REPLY.test(subj);
  const subjOk = subjLen > 0 && subjLen <= 90 && !fakeReply;
  const caps = [...new Set(`${subj} ${text}`.match(/\b[A-ZÀ-Ý]{4,}\b/g) || [])].filter((w) => !OK_CAPS.has(w) && !businessName.toUpperCase().includes(w));
  const capsList = caps.slice(0, 3).join(", ");
  const punctOk = !DOUBLE_PUNCT.test(subj) && !DOUBLE_PUNCT.test(text);
  const langName = LANGS[language] || language.toUpperCase();

  return (
    <>
      <button type="button" onClick={toggle} disabled={pending} aria-expanded={open}
        className={`btn max-sm:h-auto max-sm:min-h-9 max-sm:whitespace-normal max-sm:py-1.5 max-sm:text-center max-sm:leading-tight ${open ? "border-indigo-200 bg-indigo-50 text-indigo-700" : ""}`}>
        <Icon name={open ? "x" : "pencil"} size={14} />{open ? t("Edit band karo", "Close editor") : t("Text edit karo", "Edit text")}
      </button>
      {open && (
        <form onSubmit={onSubmit} aria-busy={pending} className="order-last col-span-2 border-t border-slate-200/70 pt-3 sm:basis-full">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_250px] lg:gap-6">
            <div className="min-w-0 space-y-3">
              <Field label="Subject" hint={<span className={subjOk ? "" : "text-amber-600"}>{subjLen}/90 characters</span>}>
                <input name="subject" defaultValue={subject} onChange={(e) => setSubj(e.target.value)} className="input" autoComplete="off" />
              </Field>
              <Field label={t("Mail ka text", "Mail text")}
                hint={t("Sirf mail ka text likho: signature aur footer apne aap judte hain. Koi link nahi.", "Write only the mail text: the signature and footer are added automatically. No links.")}
                info={t(
                  "Ye mail ka main text hai. Signature aur footer (kahan se mile, mail band karne ka tarika, address) app khud jodta hai. Link, ALL CAPS, '!!' ya 'urgent' jaise shabd mana hain.",
                  "This is the main text of the mail. The app adds the signature and footer (where the address was found, how to opt out, postal address) itself. Links, ALL CAPS, '!!' and words like 'urgent' are not allowed.",
                )}>
                <textarea name="body" defaultValue={body} rows={10} onChange={(e) => setText(e.target.value)} className="input font-sans" />
              </Field>
            </div>
            <div className="space-y-2.5 rounded-lg bg-white p-3 ring-1 ring-inset ring-slate-200 lg:mt-5 lg:self-start">
              <div className="flex items-center gap-1 text-2xs font-bold uppercase tracking-wider text-slate-400">
                Rules check
                <Info title="Rules check" size={12}
                  text={t(
                    "Likhte waqt ka jaldi wala check. Save dabane pe server saare rules dobara check karta hai (jaise 'guarantee', 'urgent' jaise shabd aur mail ki bhasha). Koi rule toota to edit save nahi hoga aur wajah message mein dikhegi.",
                    "A quick check while you type. When you press Save, the server checks all the rules again (such as words like 'guarantee' or 'urgent', and the mail's language). If a rule is broken, the edit is not saved and the message says why.",
                  )} />
              </div>
              <Check ok={wordsOk}>{t(`${words} words · 60–110 chahiye`, `${words} words · needs 60–110`)}</Check>
              <Check ok={hasQuestion}>{hasQuestion ? t("Sawaal (?) hai", "Has a question (?)") : t("Aakhir mein ek sawaal (?) likho", "End with a question (?)")}</Check>
              <Check ok={noLink}>{noLink ? t("Koi link nahi", "No links") : t("Link hatao (mana hai)", "Remove the link (not allowed)")}</Check>
              <Check ok={!caps.length}>{caps.length ? t(`CAPS wale shabd hatao: ${capsList}`, `Remove the ALL CAPS words: ${capsList}`) : t("Koi CAPS wala shabd nahi", "No ALL CAPS words")}</Check>
              <Check ok={punctOk}>{punctOk ? t("'!!' ya '??' nahi hai", "No '!!' or '??'") : t("'!!' ya '??' mat likho", "Do not write '!!' or '??'")}</Check>
              <Check ok={subjOk}>
                {fakeReply
                  ? t("Subject 'Re:' ya 'Fwd:' se shuru nahi ho sakta", "The subject cannot start with 'Re:' or 'Fwd:'")
                  : subjOk ? t("Subject theek hai", "Subject looks good") : t("Subject 1–90 characters ka ho", "The subject must be 1–90 characters")}
              </Check>
              <div className="flex items-start gap-2 text-xs font-medium text-slate-600">
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500"><Icon name="globe" size={10} strokeWidth={2.6} /></span>
                <span className="min-w-0">{t(`Bhasha wahi rakho jo mail ki hai (${langName}); doosri bhasha ka text save nahi hoga.`, `Keep the mail's language (${langName}); text in another language will not be saved.`)}</span>
              </div>
              <p className="border-t border-slate-100 pt-2 text-xs leading-relaxed text-slate-500">
                {t("Save ke baad mail ko dobara approve karna hoga. Approve hamesha saved text ka hota hai.", "After saving, the mail must be approved again. Approval always applies to the saved text.")}
                {language !== "en" && ` ${t("Right side ka English translation bhi naye text se dobara banega.", "The English translation on the right is made again from the new text.")}`}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="submit" disabled={pending} className="btn-primary">
              <Icon name={pending ? "loader" : "check"} size={14} className={pending ? "animate-spin" : ""} />
              {pending ? t("Check ho raha hai…", "Checking…") : t("Edit save karo", "Save edit")}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn">{t("Rehne do", "Cancel")}</button>
          </div>
        </form>
      )}
    </>
  );
}
