"use client";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { LANGS } from "@/lib/lang";
import { Icon } from "@/components/icons";
import { Info } from "@/components/Info";
import { friendlyError, useToast } from "@/components/toast";
import { Field } from "@/components/ui";
import { saveDraftEdit } from "../actions";

const countWords = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

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
 * Renders the "Text edit karo" button and, when open, the form (order-last puts it below the card's buttons).
 */
export function DraftEditor({ id, subject, body, language, businessName = "" }: { id: string; subject: string; body: string; language: string; businessName?: string }) {
  const toast = useToast();
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
        // a failed check comes back as "Error: Edit save nahi hua\n• reason…": the toast shows the first line as its title
        const failed = toast.result(await saveDraftEdit(id, fd), { okTitle: "Edit save ho gaya" });
        if (!failed) setOpen(false);
      } catch (err) {
        toast.error("Edit save nahi hua", friendlyError(err));
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
  const punctOk = !DOUBLE_PUNCT.test(subj) && !DOUBLE_PUNCT.test(text);
  const langName = LANGS[language] || language.toUpperCase();

  return (
    <>
      <button type="button" onClick={toggle} disabled={pending} aria-expanded={open}
        className={`btn max-sm:h-auto max-sm:min-h-9 max-sm:whitespace-normal max-sm:py-1.5 max-sm:text-center max-sm:leading-tight ${open ? "border-indigo-200 bg-indigo-50 text-indigo-700" : ""}`}>
        <Icon name={open ? "x" : "pencil"} size={14} />{open ? "Edit band karo" : "Text edit karo"}
      </button>
      {open && (
        <form onSubmit={onSubmit} aria-busy={pending} className="order-last col-span-2 border-t border-slate-200/70 pt-3 sm:basis-full">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_250px] lg:gap-6">
            <div className="min-w-0 space-y-3">
              <Field label="Subject" hint={<span className={subjOk ? "" : "text-amber-600"}>{subjLen}/90 characters</span>}>
                <input name="subject" defaultValue={subject} onChange={(e) => setSubj(e.target.value)} className="input" autoComplete="off" />
              </Field>
              <Field label="Mail ka text" hint="Sirf mail ka text likho: signature aur footer apne aap judte hain. Koi link nahi."
                info="Ye mail ka main text hai. Signature aur footer (kahan se mile, mail band karne ka tarika, address) app khud jodta hai. Link, ALL CAPS, '!!' ya 'urgent' jaise shabd mana hain.">
                <textarea name="body" defaultValue={body} rows={10} onChange={(e) => setText(e.target.value)} className="input font-sans" />
              </Field>
            </div>
            <div className="space-y-2.5 rounded-lg bg-white p-3 ring-1 ring-inset ring-slate-200 lg:mt-5 lg:self-start">
              <div className="flex items-center gap-1 text-2xs font-bold uppercase tracking-wider text-slate-400">
                Rules check
                <Info title="Rules check" size={12} text="Likhte waqt ka jaldi wala check. Save dabane pe server saare rules dobara check karta hai (jaise 'guarantee', 'urgent' jaise shabd aur mail ki bhasha). Koi rule toota to edit save nahi hoga aur wajah message mein dikhegi." />
              </div>
              <Check ok={wordsOk}>{words} words · 60–110 chahiye</Check>
              <Check ok={hasQuestion}>{hasQuestion ? "Sawaal (?) hai" : "Aakhir mein ek sawaal (?) likho"}</Check>
              <Check ok={noLink}>{noLink ? "Koi link nahi" : "Link hatao (mana hai)"}</Check>
              <Check ok={!caps.length}>{caps.length ? `CAPS wale shabd hatao: ${caps.slice(0, 3).join(", ")}` : "Koi CAPS wala shabd nahi"}</Check>
              <Check ok={punctOk}>{punctOk ? "'!!' ya '??' nahi hai" : "'!!' ya '??' mat likho"}</Check>
              <Check ok={subjOk}>{fakeReply ? "Subject 'Re:' ya 'Fwd:' se shuru nahi ho sakta" : subjOk ? "Subject theek hai" : "Subject 1–90 characters ka ho"}</Check>
              <div className="flex items-start gap-2 text-xs font-medium text-slate-600">
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500"><Icon name="globe" size={10} strokeWidth={2.6} /></span>
                <span className="min-w-0">Bhasha wahi rakho jo mail ki hai ({langName}); doosri bhasha ka text save nahi hoga.</span>
              </div>
              <p className="border-t border-slate-100 pt-2 text-xs leading-relaxed text-slate-500">Save ke baad mail ko dobara approve karna hoga. Approve hamesha saved text ka hota hai.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="submit" disabled={pending} className="btn-primary">
              <Icon name={pending ? "loader" : "check"} size={14} className={pending ? "animate-spin" : ""} />
              {pending ? "Check ho raha hai…" : "Edit save karo"}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn">Rehne do</button>
          </div>
        </form>
      )}
    </>
  );
}
