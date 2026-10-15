import Link from "next/link";
import { C, key, count, rows, type Contacted } from "@/lib/fsdb";
import { fmt } from "@/lib/time";
import { ActionButton } from "@/components/ActionButton";
import { Icon } from "@/components/icons";
import { Badge, Callout, EmptyState, NextStep, PageHeader, Section, type Tone } from "@/components/ui";
import { importSentAction } from "../actions";
import { AddContacted } from "./AddContacted";

export const metadata = { title: "Contacted Ledger" };

// ledger statuses the shared <Badge> has no Hinglish label for
const LEDGER_STATUS: Record<string, [string, Tone]> = {
  contacted_elsewhere: ["Khud contact kiya", "indigo"],
  uncertain: ["Pakka nahi", "amber"],
  refused_will_retry: ["Retry hoga", "amber"],
};
const SOURCE: Record<string, string> = { manual: "Khud daala", "sent-folder": "Sent folder", outreach: "App se bheji" };
// note the Sent-folder import stores (in English); shown in Hinglish, the stored data stays as it is
const SENT_FOLDER_NOTE = "found in mailbox Sent folder";
const SENT_FOLDER_POINTS = [
  "To, Cc aur Bcc ke saare address ledger mein aate hain",
  "Aapka apna, test aur alert address chhod diye jaate hain",
  "Dobara chalana safe hai: pehle wale address waise hi rehte hain",
];

export default async function Ledger({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Contacted Ledger"
        info="Un sabhi email address ki permanent list jinhe kabhi bhi mail gayi hai: is app se, ya aapne khud bheji. Is list ka koi bhi address dobara kabhi cold mail nahi paata. Yahan khud contact kiye address daalo, Sent folder import karo, ya check karo ki koi address pehle contact hua ya nahi."
        sub={`${total} address · Firebase mein save · kabhi delete nahi hote`}
      />

      <Callout tone="info" title="Ek address ko sirf ek baar cold mail">
        Har send se pehle database transaction mein ye list check hoti hai. Is list ka address kisi bhi list ya campaign se dobara cold mail nahi paata.
      </Callout>

      <div className="grid gap-4 md:grid-cols-2">
        <AddContacted />
        <Section
          id="sent-folder"
          title="Sent folder se import karo"
          icon="download"
          sub="Aapke mailbox (IMAP) ka Sent folder padha jata hai"
          info="Mailbox ke Sent folder ki har mail ke To / Cc / Bcc address ledger mein aa jaate hain. Pehli baar setup mein ye zaroor karo, taaki jinhe aap pehle mail kar chuke ho unhe ye app dobara cold mail na bheje. Badi mailbox mein thoda samay lagta hai."
          className="flex flex-col"
        >
          <div className="flex flex-1 flex-col gap-4">
            <ul className="space-y-2 text-sm text-slate-600">
              {SENT_FOLDER_POINTS.map((t) => (
                <li key={t} className="flex gap-2"><Icon name="check" size={14} className="mt-0.5 text-emerald-600" />{t}</li>
              ))}
            </ul>
            <p className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-500 ring-1 ring-inset ring-slate-200/70">
              <Icon name="bulb" size={14} className="mt-px text-amber-500" />
              <span><b className="font-semibold text-slate-700">Kab karein?</b> Pehli baar setup mein zaroor, aur jab bhi aapne app ke bahar bahut saari mails bheji hon.</span>
            </p>
            <div className="mt-auto pt-1">
              <ActionButton action={importSentAction} icon="download" label="Sent folder import karo" pendingText="Sent folder padh raha hai…"
                className="btn-primary w-full sm:w-auto" next="/import" nextCta="Ab leads import karo" />
            </div>
          </div>
        </Section>
      </div>

      {/* an import that finds no new address adds no sent-folder row, so the amber step also says what to do then */}
      {sentImported
        ? <NextStep text="Sent folder import ho chuka hai. Ab nayi leads import karo: jo address ledger mein hain wo import mein apne aap skip ho jayenge." href="/import" cta="Ab leads import karo" />
        : <NextStep tone="amber" text={<>Pehle upar se Sent folder import karo, taaki jinhe aap khud mail kar chuke ho unhe ye app dobara cold mail na bheje. Import kar liya aur koi naya address nahi mila? To ye step ho gaya, ab <Link href="/import" className="link">leads import karo</Link>.</>} />}

      <Section
        id="check"
        title="Check karo: kabhi contact hua?"
        icon="search"
        sub="Poora email address daalo, jaise naam@company.com"
        info="Koi bhi email address daalo aur turant pata karo ki use kabhi mail gayi hai ya nahi. Ledger mein mila to use kabhi dobara cold mail nahi jayegi. Check ke liye poora address chahiye (@ ke saath)."
        className="scroll-mt-20"
      >
        {/* GET form; #check brings the answer into view after the page reloads (phones) */}
        <form action="/ledger#check" className="flex flex-col gap-2 sm:flex-row">
          <label className="relative block min-w-0 flex-1 sm:max-w-md">
            <span className="sr-only">Email address</span>
            <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input name="q" defaultValue={q} placeholder="naam@company.com" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="input pl-9" />
          </label>
          <div className="flex gap-2">
            <button className="btn-primary h-9 flex-1 sm:flex-none">Check karo</button>
            {q && <Link href="/ledger" className="btn h-9"><Icon name="x" size={14} />Saaf karo</Link>}
          </div>
        </form>
        {q && (
          <div className="mt-3">
            {!lookup ? (
              <Callout tone="warn" title="Poora email address daalo">
                <span className="break-all">&quot;{q}&quot;</span> mein @ nahi hai. Check ke liye poora address chahiye, jaise naam@company.com.
              </Callout>
            ) : hit ? (
              <Callout tone="warn" title="Haan, ye address pehle contact ho chuka hai">
                <span className="break-all font-medium">{hit.email || q}</span> ko kabhi dobara cold mail nahi jayegi. Pehli baar: {fmt(hit.at)}.
              </Callout>
            ) : (
              <Callout tone="success" title="Nahi, ye address ledger mein nahi hai">
                Ledger ke hisaab se <span className="break-all font-medium">{q}</span> ko abhi tak koi mail nahi gayi.
              </Callout>
            )}
          </div>
        )}
      </Section>

      {/* a lookup that found nothing is fully answered by the callout above */}
      {(!lookup || hit) && (
        <Section
          flush
          title="Ledger ke address"
          icon="database"
          info="Ledger ke sabse naye 300 address, naya sabse upar. Status batata hai ki mail ka kya hua. Source batata hai ki address kahan se aaya: app ki bheji mail, khud daala, ya Sent folder. Yahan se kabhi kuch delete nahi hota."
          sub={lookup ? "Search ka result" : items.length < total ? `Sabse naye ${items.length} dikh rahe hain, kul ${total}` : `Saare ${total} address · naya sabse upar`}
        >
          <LedgerTable items={items} />
        </Section>
      )}
    </div>
  );
}

function LedgerTable({ items }: { items: Contacted[] }) {
  if (!items.length) {
    return <EmptyState icon="shield" title="Ledger abhi khaali hai" text="Jaise hi app se koi mail jayegi, ya aap upar se address daaloge ya Sent folder import karoge, wo yahan dikhenge." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="tbl tbl-stack">
        <thead><tr><th>Email</th><th>Status</th><th>Source</th><th>Pehli baar</th><th>Note</th></tr></thead>
        <tbody>
          {items.map((r) => {
            const st = LEDGER_STATUS[r.status];
            return (
              <tr key={r.id}>
                <td className="break-all font-medium text-slate-900">{r.email || r.id}</td>
                <td data-label="Status">{r.status ? <Badge v={r.status} label={st?.[0]} tone={st?.[1]} /> : "—"}</td>
                <td data-label="Source" className="whitespace-nowrap">{SOURCE[r.source] ?? (r.source || "—")}</td>
                <td data-label="Pehli baar" className="whitespace-nowrap text-slate-500">{fmt(r.at)}</td>
                <td data-label="Note" className={`break-words text-xs text-slate-500 ${r.note ? "" : "max-md:!hidden"}`}>{r.note === SENT_FOLDER_NOTE ? "Mailbox ke Sent folder se" : r.note || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
