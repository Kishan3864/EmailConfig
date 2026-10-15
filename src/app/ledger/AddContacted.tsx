"use client";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Section } from "@/components/ui";
import { addContactedAction } from "../actions";

/** Ledger card: addresses the user already emailed outside the app. The result shows as a toast. */
export function AddContacted() {
  return (
    <ActionForm action={addContactedAction} reset ok="Ledger mein add ho gaye" className="flex">
      <Section
        title="Khud contact kiye address daalo"
        icon="mail-check"
        sub="Jinhe aap app ke bahar pehle hi mail kar chuke ho"
        info="Jinhe aapne pehle hi Gmail, Outlook waghera se mail kiya hai, unke address yahan daalo. Ye ledger mein chale jaate hain aur ye app unhe kabhi cold mail nahi bhejega. Agar wo kisi list mein 'Ready' ya 'Review chahiye' mein hain, to unka status 'Pehle contact hua' ho jata hai."
        className="flex w-full flex-col"
      >
        <div className="flex flex-1 flex-col gap-3">
          <Field label="Email address" info="Ek ya kai email ek saath daal sakte ho. Space, comma ya nayi line se alag karo. Galat format wale aur pehle se ledger wale address apne aap chhod diye jaate hain.">
            <textarea name="emails" required rows={4} className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              placeholder={"naam@company.com, info@firm.de\nSpace, comma ya nayi line se alag karo"} />
          </Field>
          <Field label="Note (optional)" info="Sirf aapke yaad ke liye, jaise 'LinkedIn pe baat hui thi'. Ye note neeche ledger table mein dikhta hai.">
            <input name="note" className="input" placeholder="Jaise: LinkedIn pe baat hui thi" />
          </Field>
          <div className="mt-auto pt-1">
            <SubmitButton icon="plus" pendingText="Save ho raha hai…" className="btn-primary w-full sm:w-auto">Ledger mein daalo</SubmitButton>
          </div>
        </div>
      </Section>
    </ActionForm>
  );
}
