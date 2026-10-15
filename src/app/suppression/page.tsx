import { C, rows, type Suppression } from "@/lib/fsdb";
import type { Lang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { fmt } from "@/lib/time";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Badge, EmptyState, Field, NextStep, PageHeader, Section } from "@/components/ui";
import { addSuppression } from "../actions";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Block List", "Block list") };
}

// reasons the app writes by itself; anything else is what the user typed
const REASON: Record<string, { hi: string; en: string }> = {
  manual: { hi: "Khud daala", en: "Added manually" },
  "opt-out reply": { hi: "Opt-out reply aaya", en: "Opt-out reply" },
  "hard bounce": { hi: "Hard bounce", en: "Hard bounce" },
  "hard bounce (SMTP)": { hi: "Hard bounce (SMTP)", en: "Hard bounce (SMTP)" },
};
// own keys only: a typed reason like "constructor" must not pick up an Object.prototype member
const reasonText = (lang: Lang, r?: string) => (r ? (Object.hasOwn(REASON, r) ? REASON[r][lang] : r) : "").trim() || "—";
const LIMIT = 1000; // the page shows the newest 1000 entries
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function SuppressionPage() {
  const { t, lang } = await getT();
  const items = rows<Suppression>(await C.suppression.orderBy("createdAt", "desc").limit(LIMIT).get());
  const capped = items.length >= LIMIT; // there can be more entries than shown, so counts read "1000+"
  const domains = items.filter((r) => r.kind === "domain").length;
  const example = t("naam@company.com", "name@company.com");
  return (
    <div className="space-y-5">
      <PageHeader
        title={t("Block List", "Block list")}
        info={t(
          "Is list ke email ya poore domain ko kabhi bhi mail nahi jaati. Ye permanent hai. Opt-out reply aur hard bounce wale address apne aap yahan aa jaate hain. Add karte hi jo leads 'Ready' ya 'Review chahiye' mein hain, wo 'Block list' status mein chale jaate hain.",
          "Emails and whole domains on this list are never emailed. It is permanent. Addresses that send an opt-out reply or hard bounce are added automatically. As soon as you add an entry, its leads that are 'Ready' or 'Needs review' move to the 'Blocked' status.",
        )}
        sub={t(
          `${capped ? `${LIMIT}+` : items.length} entry · permanent · inhe kabhi mail nahi jaati`,
          `${capped ? `${LIMIT}+` : items.length} ${items.length === 1 ? "entry" : "entries"} · permanent · never emailed`,
        )}
      />

      <Section
        title={t("Block list mein add karo", "Add to block list")}
        icon="ban"
        sub={t("Ek ya kai email / domain ek saath", "One or more emails / domains at once")}
        info={t(
          "Poora email daalo (naam@company.com) to sirf wahi address block hoga. Sirf domain daalo (company.com) to us domain ke saare address block ho jayenge. Ye permanent hai, isliye soch ke daalo.",
          "Enter a full email (name@company.com) to block just that address. Enter only a domain (company.com) to block every address on that domain. This is permanent, so add with care.",
        )}
      >
        <ActionForm action={addSuppression} reset ok={t("Block list mein add ho gaya", "Added to the block list")} className="space-y-4">
          <Field
            label={t("Email ya domain", "Email or domain")}
            info={t(
              "Space, comma ya nayi line se alag karo. Domain ke aage @ ho to bhi chalega (@company.com). Jo pehle se list mein hai wo dobara add nahi hota.",
              "Separate with spaces, commas or new lines. A domain with a leading @ works too (@company.com). Entries already on the list are not added again.",
            )}
            hint={
              <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-1.5"><code className="font-mono text-slate-600">{example}</code><Icon name="arrow-right" size={12} />{t("sirf ye email", "only this email")}</span>
                <span className="inline-flex items-center gap-1.5"><code className="font-mono text-slate-600">company.com</code><Icon name="arrow-right" size={12} />{t("poore domain ke saare address", "every address on the domain")}</span>
              </span>
            }
          >
            <textarea name="values" required rows={3} className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              placeholder={t("naam@company.com, competitor.com\nSpace, comma ya nayi line se alag karo", "name@company.com, competitor.com\nSeparate with spaces, commas or new lines")} />
          </Field>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label={t("Wajah (optional)", "Reason (optional)")} info={t(
              "Kyun block kiya, apne yaad ke liye. Khaali chhodoge to 'Khud daala' likha jayega.",
              "Why you blocked it, as a reminder for you. Left empty, it says 'Added manually'.",
            )} className="flex-1">
              <input name="reason" className="input" placeholder={t("Jaise: competitor, purana client, mana kiya", "E.g. competitor, old client, said no")} />
            </Field>
            <SubmitButton icon="ban" className="btn-primary h-9 w-full sm:w-auto">{t("Block list mein daalo", "Add to block list")}</SubmitButton>
          </div>
        </ActionForm>
      </Section>

      {items.length === 0
        ? <NextStep
            text={t(
              "Jinhe kabhi mail nahi bhejni (competitor, purane client, apni company), unhe upar block list mein daalo. Uske baad leads import karo.",
              "Add anyone you never want to email (competitors, old clients, your own company) to the block list above. Then import leads.",
            )}
            href="/import" cta={t("Leads import karo", "Import leads")} />
        : <NextStep
            text={t(
              "Block list set hai. Ab leads import karo: block list wale email aur domain import mein apne aap skip ho jayenge.",
              "Your block list is set. Now import leads: blocked emails and domains are skipped automatically during import.",
            )}
            href="/import" cta={t("Leads import karo", "Import leads")} />}

      <Section
        flush
        title={t("Blocked email aur domain", "Blocked emails and domains")}
        icon="list"
        info={t(
          "Is list ki har entry permanent hai: inhe kabhi mail nahi jaati. Type batata hai ki sirf ek email block hai ya poora domain. Wajah batati hai ki ye kaise aaya: khud daala, opt-out reply ya hard bounce. Naya sabse upar.",
          "Every entry on this list is permanent: they are never emailed. Type shows whether a single email or a whole domain is blocked. Reason shows how it got here: added manually, opt-out reply or hard bounce. Newest first.",
        )}
        sub={items.length ? t(
          `${capped ? `Sabse naye ${LIMIT} dikh rahe hain: ` : ""}${items.length - domains} email · ${domains} domain`,
          `${capped ? `Showing the newest ${LIMIT}: ` : ""}${plural(items.length - domains, "email")} · ${plural(domains, "domain")}`,
        ) : undefined}
      >
        {items.length ? (
          <div className="overflow-x-auto">
            <table className="tbl tbl-stack">
              <thead><tr><th>Email / domain</th><th>Type</th><th>{t("Wajah", "Reason")}</th><th>{t("Kab add hua", "Added")}</th></tr></thead>
              <tbody>
                {items.map((r) => {
                  const domain = r.kind === "domain";
                  return (
                    <tr key={r.id}>
                      <td className="break-all font-medium text-slate-900">{r.value || r.id}</td>
                      <td data-label="Type"><Badge v={domain ? "domain" : "email"} label={domain ? t("Poora domain", "Whole domain") : "Email"} tone={domain ? "violet" : "slate"} /></td>
                      <td data-label={t("Wajah", "Reason")} className="break-words">{reasonText(lang, r.reason)}</td>
                      <td data-label={t("Kab add hua", "Added")} className="whitespace-nowrap text-slate-500">{fmt(r.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="ban" title={t("Block list khaali hai", "The block list is empty")}
            text={t(
              "Abhi koi email ya domain block nahi hai. Upar ke form se add karo. Opt-out reply aur hard bounce wale address apne aap yahan aa jayenge.",
              "No email or domain is blocked yet. Add them with the form above. Addresses that send an opt-out reply or hard bounce are added here automatically.",
            )} />
        )}
      </Section>
    </div>
  );
}
