"use client";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { useT } from "@/components/lang";
import { Field, Section } from "@/components/ui";
import { addContactedAction } from "../actions";

/** Ledger card: addresses the user already emailed outside the app. The result shows as a toast. */
export function AddContacted() {
  const { t } = useT();
  return (
    <ActionForm action={addContactedAction} reset ok={t("Ledger mein add ho gaye", "Added to the ledger")} className="flex">
      <Section
        title={t("Khud contact kiye address daalo", "Add already-contacted addresses")}
        icon="mail-check"
        sub={t("Jinhe aap app ke bahar pehle hi mail kar chuke ho", "People you already emailed outside the app")}
        info={t(
          "Jinhe aapne pehle hi Gmail, Outlook waghera se mail kiya hai, unke address yahan daalo. Ye ledger mein chale jaate hain aur ye app unhe kabhi cold mail nahi bhejega. Agar wo kisi list mein 'Ready' ya 'Review chahiye' mein hain, to unka status 'Pehle contact hua' ho jata hai.",
          "Add the addresses of people you already emailed from Gmail, Outlook and so on. They go into the ledger and the app will never send them a cold mail. If they are 'Ready' or 'Needs review' in any list, their status changes to 'Already contacted'.",
        )}
        className="flex w-full flex-col"
      >
        <div className="flex flex-1 flex-col gap-3">
          <Field label="Email address" info={t(
            "Ek ya kai email ek saath daal sakte ho. Space, comma ya nayi line se alag karo. Galat format wale aur pehle se ledger wale address apne aap chhod diye jaate hain.",
            "You can add one or many emails at once. Separate them with spaces, commas or new lines. Invalid addresses and ones already in the ledger are skipped automatically.",
          )}>
            <textarea name="emails" required rows={4} className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              placeholder={t("naam@company.com, info@firm.de\nSpace, comma ya nayi line se alag karo", "name@company.com, info@firm.de\nSeparate with spaces, commas or new lines")} />
          </Field>
          <Field label="Note (optional)" info={t(
            "Sirf aapke yaad ke liye, jaise 'LinkedIn pe baat hui thi'. Ye note neeche ledger table mein dikhta hai.",
            "Just a reminder for you, like 'Talked on LinkedIn'. The note shows in the ledger table below.",
          )}>
            <input name="note" className="input" placeholder={t("Jaise: LinkedIn pe baat hui thi", "E.g. Talked on LinkedIn")} />
          </Field>
          <div className="mt-auto pt-1">
            <SubmitButton icon="plus" pendingText={t("Save ho raha hai…", "Saving…")} className="btn-primary w-full sm:w-auto">{t("Ledger mein daalo", "Add to ledger")}</SubmitButton>
          </div>
        </div>
      </Section>
    </ActionForm>
  );
}
