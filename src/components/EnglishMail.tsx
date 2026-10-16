"use client";
import type { EnglishState } from "@/lib/english";
import { ActionButton } from "./ActionButton";
import { Icon } from "./icons";
import { useT } from "./lang";
import { MailPreview } from "./ui";

const LABEL = "mb-1.5 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400";
const BOX = "rounded-lg border border-dashed px-4 py-6 text-center text-xs leading-relaxed";

/**
 * The right-hand side next to a mail: the same mail in English, only for me to check what the lead will read.
 * Never sent. `text` is the English body as the page shows it (with signature and English footer when the left side
 * shows them); `action` (translateMessage bound to the mail) makes the translation now. Whether and when the worker
 * makes a missing one comes with `en` (englishOf in lib/english.ts).
 */
export function EnglishMail({ en, text, action }: { en: EnglishState; text?: string; action?: () => Promise<string | void> }) {
  const { t } = useT();
  const make = (label: string, cls = "btn btn-sm") => action && (
    <ActionButton action={action} label={label} icon="globe" pendingText={t("Translate ho raha hai…", "Translating…")} className={cls} />
  );

  if (en.kind === "same") {
    return (
      <div className="min-w-0">
        <div className={LABEL}><Icon name="globe" size={12} />English</div>
        <div className={`${BOX} border-indigo-200 bg-indigo-50/30 text-slate-600`}>
          <Icon name="check-circle" size={16} className="mx-auto mb-1.5 text-indigo-400" />
          {t(
            "Ye mail English mein hi hai: left mein jo text hai, lead ko wahi jayega aur uska meaning bhi wahi hai.",
            "This mail is already in English: the lead gets exactly the text on the left, and that is its meaning.",
          )}
        </div>
      </div>
    );
  }

  if (en.kind === "pending") {
    // a rejected mail is never sent, so it never gets an English version
    if (en.rejected && !action) {
      return (
        <div className="min-w-0">
          <div className={LABEL}><Icon name="globe" size={12} />English translation</div>
          <div className={`${BOX} border-slate-200 text-slate-500`}>
            {t("Is mail ka English translation nahi bana: mail reject ho chuki hai, ye kabhi nahi jayegi.", "No English translation was made for this mail: it was rejected and will never be sent.")}
          </div>
        </div>
      );
    }
    const failed = !!en.error;
    // when the worker tries next: right away for a new or edited mail, later (2 min, 15 min, … 6 h) after a failed try
    const soon = en.retryIn === undefined || en.retryIn <= 2;
    const when = soon ? t("1-2 minute mein", "within a minute or two") : t(`lagbhag ${en.retryIn} minute mein`, `in about ${en.retryIn} minutes`);
    return (
      <div className="min-w-0">
        <div className={LABEL}><Icon name="globe" size={12} />English translation</div>
        <div className={`${BOX} ${failed ? "border-amber-200 bg-amber-50/50 text-amber-800" : "border-slate-200 text-slate-500"}`}>
          <Icon name={failed ? "alert" : "clock"} size={16} className={`mx-auto mb-1.5 ${failed ? "text-amber-500" : "text-slate-400"}`} />
          <p className="font-medium">
            {failed
              ? t("English translation abhi nahi ban paya", "The English translation could not be made yet")
              : en.stale
                ? t("Text badla hai: naya English translation ban raha hai", "The text changed: a new English translation is being made")
                : en.queued
                  ? t("English translation ban raha hai", "The English translation is being made")
                  : t("English translation abhi nahi hai", "No English translation yet")}
          </p>
          <p className="mt-1">
            {en.queued
              ? failed
                ? action
                  ? t(`Worker ${when} apne aap dobara try karega, ya abhi banao.`, `The worker tries again by itself ${when}, or make it now.`)
                  : t(`Worker ${when} apne aap dobara try karega.`, `The worker tries again by itself ${when}.`)
                : action
                  ? t(`Worker ${when} apne aap bana dega, ya abhi banao.`, `The worker makes it ${when}, or make it now.`)
                  : t(`Worker ${when} apne aap bana dega.`, `The worker makes it ${when}.`)
              : action
                ? t("Worker ab apne aap try nahi karega: neeche button se banao.", "The worker will not try again by itself: make it with the button below.")
                : t("Worker ab apne aap try nahi karega.", "The worker will not try again by itself.")}
          </p>
          {failed && <p className="mt-1 break-words text-2xs text-amber-700/80">{t("Wajah", "Reason")}: {en.error}</p>}
          {action && <div className="mt-3 flex justify-center">{make(t("Abhi translation banao", "Make translation now"))}</div>}
        </div>
      </div>
    );
  }

  return (
    <MailPreview label="English translation" subject={en.subject || undefined} text={text ?? en.body} tone="translation"
      footer={(
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 border-t border-indigo-100 px-3 py-2 text-2xs leading-relaxed text-slate-500">
          {/* the note keeps at least 12rem, so on phones and narrow columns the button wraps below it instead of squeezing it */}
          <span className="flex min-w-[12rem] flex-1 items-start gap-1.5">
            <Icon name="info" size={12} className="mt-px shrink-0 text-indigo-400" />
            {t(
              <>Sirf aapke check ke liye: left wali mail ka English matlab. Lead ko ye nahi jaata, use sirf left wala text jaata hai.</>,
              <>Only for you to check: the meaning of the mail on the left in English. The lead does not get this; they only get the text on the left.</>,
            )}
          </span>
          {make(t("Dobara translate karo", "Translate again"), "btn-ghost btn-sm -my-1 ml-auto shrink-0")}
        </div>
      )} />
  );
}
