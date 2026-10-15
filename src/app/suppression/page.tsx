import { C, rows, type Suppression } from "@/lib/fsdb";
import { fmt } from "@/lib/time";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Badge, EmptyState, Field, NextStep, PageHeader, Section } from "@/components/ui";
import { addSuppression } from "../actions";

export const metadata = { title: "Block List" };

// reasons the app writes by itself; anything else is what the user typed
const REASON: Record<string, string> = { manual: "Khud daala", "opt-out reply": "Opt-out reply aaya", "hard bounce": "Hard bounce", "hard bounce (SMTP)": "Hard bounce (SMTP)" };
// own keys only: a typed reason like "constructor" must not pick up an Object.prototype member
const reasonText = (r?: string) => (r ? (Object.hasOwn(REASON, r) ? REASON[r] : r) : "").trim() || "—";
const LIMIT = 1000; // the page shows the newest 1000 entries

export default async function SuppressionPage() {
  const items = rows<Suppression>(await C.suppression.orderBy("createdAt", "desc").limit(LIMIT).get());
  const capped = items.length >= LIMIT; // there can be more entries than shown, so counts read "1000+"
  const domains = items.filter((r) => r.kind === "domain").length;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Block List"
        info="Is list ke email ya poore domain ko kabhi bhi mail nahi jaati. Ye permanent hai. Opt-out reply aur hard bounce wale address apne aap yahan aa jaate hain. Add karte hi jo leads 'Ready' ya 'Review chahiye' mein hain, wo 'Block list' status mein chale jaate hain."
        sub={`${capped ? `${LIMIT}+` : items.length} entry · permanent · inhe kabhi mail nahi jaati`}
      />

      <Section
        title="Block list mein add karo"
        icon="ban"
        sub="Ek ya kai email / domain ek saath"
        info="Poora email daalo (naam@company.com) to sirf wahi address block hoga. Sirf domain daalo (company.com) to us domain ke saare address block ho jayenge. Ye permanent hai, isliye soch ke daalo."
      >
        <ActionForm action={addSuppression} reset ok="Block list mein add ho gaya" className="space-y-4">
          <Field
            label="Email ya domain"
            info="Space, comma ya nayi line se alag karo. Domain ke aage @ ho to bhi chalega (@company.com). Jo pehle se list mein hai wo dobara add nahi hota."
            hint={
              <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-1.5"><code className="font-mono text-slate-600">naam@company.com</code><Icon name="arrow-right" size={12} />sirf ye email</span>
                <span className="inline-flex items-center gap-1.5"><code className="font-mono text-slate-600">company.com</code><Icon name="arrow-right" size={12} />poore domain ke saare address</span>
              </span>
            }
          >
            <textarea name="values" required rows={3} className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              placeholder={"naam@company.com, competitor.com\nSpace, comma ya nayi line se alag karo"} />
          </Field>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Wajah (optional)" info="Kyun block kiya, apne yaad ke liye. Khaali chhodoge to 'Khud daala' likha jayega." className="flex-1">
              <input name="reason" className="input" placeholder="Jaise: competitor, purana client, mana kiya" />
            </Field>
            <SubmitButton icon="ban" className="btn-primary h-9 w-full sm:w-auto">Block list mein daalo</SubmitButton>
          </div>
        </ActionForm>
      </Section>

      {items.length === 0
        ? <NextStep text="Jinhe kabhi mail nahi bhejni (competitor, purane client, apni company), unhe upar block list mein daalo. Uske baad leads import karo." href="/import" cta="Leads import karo" />
        : <NextStep text="Block list set hai. Ab leads import karo: block list wale email aur domain import mein apne aap skip ho jayenge." href="/import" cta="Leads import karo" />}

      <Section
        flush
        title="Blocked email aur domain"
        icon="list"
        info="Is list ki har entry permanent hai: inhe kabhi mail nahi jaati. Type batata hai ki sirf ek email block hai ya poora domain. Wajah batati hai ki ye kaise aaya: khud daala, opt-out reply ya hard bounce. Naya sabse upar."
        sub={items.length ? `${capped ? `Sabse naye ${LIMIT} dikh rahe hain: ` : ""}${items.length - domains} email · ${domains} domain` : undefined}
      >
        {items.length ? (
          <div className="overflow-x-auto">
            <table className="tbl tbl-stack">
              <thead><tr><th>Email / domain</th><th>Type</th><th>Wajah</th><th>Kab add hua</th></tr></thead>
              <tbody>
                {items.map((r) => {
                  const domain = r.kind === "domain";
                  return (
                    <tr key={r.id}>
                      <td className="break-all font-medium text-slate-900">{r.value || r.id}</td>
                      <td data-label="Type"><Badge v={domain ? "domain" : "email"} label={domain ? "Poora domain" : "Email"} tone={domain ? "violet" : "slate"} /></td>
                      <td data-label="Wajah" className="break-words">{reasonText(r.reason)}</td>
                      <td data-label="Kab add hua" className="whitespace-nowrap text-slate-500">{fmt(r.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="ban" title="Block list khaali hai"
            text="Abhi koi email ya domain block nahi hai. Upar ke form se add karo. Opt-out reply aur hard bounce wale address apne aap yahan aa jayenge." />
        )}
      </Section>
    </div>
  );
}
