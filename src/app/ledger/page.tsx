import Link from "next/link";
import { C, key, count, rows, type Contacted } from "@/lib/fsdb";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { fmt } from "@/lib/time";
import { ActionButton } from "@/components/ActionButton";
import { Icon } from "@/components/icons";
import { Badge, Callout, EmptyState, NextStep, PageHeader, Section, type Tone } from "@/components/ui";
import { importSentAction } from "../actions";
import { AddContacted } from "./AddContacted";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Contacted Ledger", "Contacted ledger") };
}

// ledger statuses shown with a ledger-specific label and colour (the rest use the shared <Badge> labels)
const LEDGER_STATUS: Record<string, { hi: string; en: string; tone: Tone }> = {
  contacted_elsewhere: { hi: "Khud contact kiya", en: "Contacted by you", tone: "indigo" },
  uncertain: { hi: "Pakka nahi", en: "Uncertain", tone: "amber" },
  refused_will_retry: { hi: "Retry hoga", en: "Will retry", tone: "amber" },
};
const SOURCE: Record<string, { hi: string; en: string }> = {
  manual: { hi: "Khud daala", en: "Added manually" },
  "sent-folder": { hi: "Sent folder", en: "Sent folder" },
  outreach: { hi: "App se bheji", en: "Sent by the app" },
};
// note the Sent-folder import stores (in English); shown translated, the stored data stays as it is
const SENT_FOLDER_NOTE = "found in mailbox Sent folder";
const SENT_FOLDER_POINTS = [
  { hi: "To, Cc aur Bcc ke saare address ledger mein aate hain", en: "Every To, Cc and Bcc address goes into the ledger" },
  { hi: "Aapka apna, test aur alert address chhod diye jaate hain", en: "Your own, test and alert addresses are skipped" },
  { hi: "Dobara chalana safe hai: pehle wale address waise hi rehte hain", en: "Safe to run again: existing addresses stay as they are" },
];

export default async function Ledger({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { t } = await getT();
  const { q = "" } = await searchParams;
  const total = await count(C.contacted);
  // every app send also adds a ledger row, so a non-empty ledger does not mean the Sent folder was imported
  const sentImported = !(await C.contacted.where("source", "==", "sent-folder").limit(1).get()).empty;
  let items: Contacted[];
  if (q.includes("@")) {
    const d = await C.contacted.doc(key(q)).get();
    items = d.exists ? [{ id: d.id, ...d.data() } as Contacted] : [];
  } else items = rows<Contacted>(await C.contacted.orderBy("at", "desc").limit(300).get());
  const lookup = q.includes("@");
  const hit = lookup ? items[0] : undefined;
  const addresses = (n: number) => `${n} ${n === 1 ? "address" : "addresses"}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("Contacted Ledger", "Contacted ledger")}
        info={t(
          "Un sabhi email address ki permanent list jinhe kabhi bhi mail gayi hai: is app se, ya aapne khud bheji. Is list ka koi bhi address dobara kabhi cold mail nahi paata. Yahan khud contact kiye address daalo, Sent folder import karo, ya check karo ki koi address pehle contact hua ya nahi.",
          "The permanent list of every email address that was ever emailed, whether by this app or by you. No address on this list ever gets another cold mail. Add addresses you contacted yourself, import your Sent folder, or check whether an address was contacted before.",
        )}
        sub={t(`${total} address · Firebase mein save · kabhi delete nahi hote`, `${addresses(total)} · saved in Firebase · never deleted`)}
      />

      <Callout tone="info" title={t("Ek address ko sirf ek baar cold mail", "Each address gets only one cold mail")}>
        {t(
          "Har send se pehle database transaction mein ye list check hoti hai. Is list ka address kisi bhi list ya campaign se dobara cold mail nahi paata.",
          "Before every send, the app checks this list inside a database transaction. An address on it never gets a second cold mail, from any list or campaign.",
        )}
      </Callout>

      <div className="grid gap-4 md:grid-cols-2">
        <AddContacted />
        <Section
          id="sent-folder"
          title={t("Sent folder se import karo", "Import from Sent folder")}
          icon="download"
          sub={t("Aapke mailbox (IMAP) ka Sent folder padha jata hai", "Reads the Sent folder of your mailbox (IMAP)")}
          info={t(
            "Mailbox ke Sent folder ki har mail ke To / Cc / Bcc address ledger mein aa jaate hain. Pehli baar setup mein ye zaroor karo, taaki jinhe aap pehle mail kar chuke ho unhe ye app dobara cold mail na bheje. Badi mailbox mein thoda samay lagta hai.",
            "The To / Cc / Bcc addresses of every mail in your mailbox's Sent folder go into the ledger. Always do this during first setup, so the app never cold-mails people you have already emailed. A large mailbox takes a little while.",
          )}
          className="flex flex-col"
        >
          <div className="flex flex-1 flex-col gap-4">
            <ul className="space-y-2 text-sm text-slate-600">
              {SENT_FOLDER_POINTS.map((p) => (
                <li key={p.hi} className="flex gap-2"><Icon name="check" size={14} className="mt-0.5 text-emerald-600" />{t(p.hi, p.en)}</li>
              ))}
            </ul>
            <p className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-500 ring-1 ring-inset ring-slate-200/70">
              <Icon name="bulb" size={14} className="mt-px text-amber-500" />
              {t(
                <span><b className="font-semibold text-slate-700">Kab karein?</b> Pehli baar setup mein zaroor, aur jab bhi aapne app ke bahar bahut saari mails bheji hon.</span>,
                <span><b className="font-semibold text-slate-700">When to do this?</b> Always during first setup, and whenever you have sent a lot of mails outside the app.</span>,
              )}
            </p>
            <div className="mt-auto pt-1">
              <ActionButton action={importSentAction} icon="download" label={t("Sent folder import karo", "Import Sent folder")} pendingText={t("Sent folder padh raha hai…", "Reading the Sent folder…")}
                className="btn-primary w-full sm:w-auto" next="/import" nextCta={t("Ab leads import karo", "Import leads now")} />
            </div>
          </div>
        </Section>
      </div>

      {/* an import that finds no new address adds no sent-folder row, so the amber step also says what to do then */}
      {sentImported
        ? <NextStep
            text={t(
              "Sent folder import ho chuka hai. Ab nayi leads import karo: jo address ledger mein hain wo import mein apne aap skip ho jayenge.",
              "Your Sent folder has been imported. Now import new leads: addresses already in the ledger are skipped automatically during import.",
            )}
            href="/import" cta={t("Ab leads import karo", "Import leads now")} />
        : <NextStep tone="amber" text={t(
            <>Pehle upar se Sent folder import karo, taaki jinhe aap khud mail kar chuke ho unhe ye app dobara cold mail na bheje. Import kar liya aur koi naya address nahi mila? To ye step ho gaya, ab <Link href="/import" className="link">leads import karo</Link>.</>,
            <>First import your Sent folder above, so the app never cold-mails people you have already emailed yourself. Imported it and no new address was found? Then this step is done: now <Link href="/import" className="link">import leads</Link>.</>,
          )} />}

      <Section
        id="check"
        title={t("Check karo: kabhi contact hua?", "Check: was it ever contacted?")}
        icon="search"
        sub={t("Poora email address daalo, jaise naam@company.com", "Enter the full email address, like name@company.com")}
        info={t(
          "Koi bhi email address daalo aur turant pata karo ki use kabhi mail gayi hai ya nahi. Ledger mein mila to use kabhi dobara cold mail nahi jayegi. Check ke liye poora address chahiye (@ ke saath).",
          "Enter any email address and instantly see whether it was ever emailed. If it is in the ledger, it will never get a cold mail again. The check needs the full address (with the @).",
        )}
        className="scroll-mt-20"
      >
        {/* GET form; #check brings the answer into view after the page reloads (phones) */}
        <form action="/ledger#check" className="flex flex-col gap-2 sm:flex-row">
          <label className="relative block min-w-0 flex-1 sm:max-w-md">
            <span className="sr-only">Email address</span>
            <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input name="q" defaultValue={q} placeholder={t("naam@company.com", "name@company.com")} inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="input pl-9" />
          </label>
          <div className="flex gap-2">
            <button className="btn-primary h-9 flex-1 sm:flex-none">{t("Check karo", "Check")}</button>
            {q && <Link href="/ledger" className="btn h-9"><Icon name="x" size={14} />{t("Saaf karo", "Clear")}</Link>}
          </div>
        </form>
        {q && (
          <div className="mt-3">
            {!lookup ? (
              <Callout tone="warn" title={t("Poora email address daalo", "Enter the full email address")}>
                {t(
                  <><span className="break-all">&quot;{q}&quot;</span> mein @ nahi hai. Check ke liye poora address chahiye, jaise naam@company.com.</>,
                  <><span className="break-all">&quot;{q}&quot;</span> has no @. The check needs the full address, like name@company.com.</>,
                )}
              </Callout>
            ) : hit ? (
              <Callout tone="warn" title={t("Haan, ye address pehle contact ho chuka hai", "Yes, this address was already contacted")}>
                {t(
                  <><span className="break-all font-medium">{hit.email || q}</span> ko kabhi dobara cold mail nahi jayegi. Pehli baar: {fmt(hit.at)}.</>,
                  <><span className="break-all font-medium">{hit.email || q}</span> will never get a cold mail again. First contacted: {fmt(hit.at)}.</>,
                )}
              </Callout>
            ) : (
              <Callout tone="success" title={t("Nahi, ye address ledger mein nahi hai", "No, this address is not in the ledger")}>
                {t(
                  <>Ledger ke hisaab se <span className="break-all font-medium">{q}</span> ko abhi tak koi mail nahi gayi.</>,
                  <>According to the ledger, <span className="break-all font-medium">{q}</span> has not been emailed yet.</>,
                )}
              </Callout>
            )}
          </div>
        )}
      </Section>

      {/* a lookup that found nothing is fully answered by the callout above */}
      {(!lookup || hit) && (
        <Section
          flush
          title={t("Ledger ke address", "Addresses in the ledger")}
          icon="database"
          info={t(
            "Ledger ke sabse naye 300 address, naya sabse upar. Status batata hai ki mail ka kya hua. Source batata hai ki address kahan se aaya: app ki bheji mail, khud daala, ya Sent folder. Yahan se kabhi kuch delete nahi hota.",
            "The newest 300 addresses in the ledger, newest first. Status shows what happened to the mail. Source shows where the address came from: a mail sent by the app, added manually, or the Sent folder. Nothing is ever deleted here.",
          )}
          sub={lookup ? t("Search ka result", "Search result")
            : items.length < total ? t(`Sabse naye ${items.length} dikh rahe hain, kul ${total}`, `Showing the newest ${items.length} of ${total}`)
            : t(`Saare ${total} address · naya sabse upar`, `${total === 1 ? "1 address" : `All ${total} addresses`} · newest first`)}
        >
          <LedgerTable items={items} t={t} />
        </Section>
      )}
    </div>
  );
}

function LedgerTable({ items, t }: { items: Contacted[]; t: T }) {
  if (!items.length) {
    return (
      <EmptyState icon="shield" title={t("Ledger abhi khaali hai", "The ledger is empty")}
        text={t(
          "Jaise hi app se koi mail jayegi, ya aap upar se address daaloge ya Sent folder import karoge, wo yahan dikhenge.",
          "As soon as the app sends a mail, or you add addresses above or import your Sent folder, they show up here.",
        )} />
    );
  }
  const firstTime = t("Pehli baar", "First contacted");
  return (
    <div className="overflow-x-auto">
      <table className="tbl tbl-stack">
        <thead><tr><th>Email</th><th>Status</th><th>Source</th><th>{firstTime}</th><th>Note</th></tr></thead>
        <tbody>
          {items.map((r) => {
            const st = LEDGER_STATUS[r.status];
            const src = SOURCE[r.source];
            return (
              <tr key={r.id}>
                <td className="break-all font-medium text-slate-900">{r.email || r.id}</td>
                <td data-label="Status">{r.status ? <Badge v={r.status} label={st && t(st.hi, st.en)} tone={st?.tone} /> : "—"}</td>
                <td data-label="Source" className="whitespace-nowrap">{src ? t(src.hi, src.en) : (r.source || "—")}</td>
                <td data-label={firstTime} className="whitespace-nowrap text-slate-500">{fmt(r.at)}</td>
                <td data-label="Note" className={`break-words text-xs text-slate-500 ${r.note ? "" : "max-md:!hidden"}`}>{r.note === SENT_FOLDER_NOTE ? t("Mailbox ke Sent folder se", "From the mailbox's Sent folder") : r.note || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
