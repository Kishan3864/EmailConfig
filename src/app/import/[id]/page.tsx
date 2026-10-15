import Link from "next/link";
import { notFound } from "next/navigation";
import { C, rows, type ImportRow, type LeadList } from "@/lib/fsdb";
import { fmt } from "@/lib/time";
import type { IconName } from "@/components/icons";
import { Info } from "@/components/Info";
import { ToastOnMount } from "@/components/toast";
import { Badge, Callout, EmptyState, NextStep, PageHeader, Section, Stat, Steps, type StepState, type Tone } from "@/components/ui";
import { ConfirmImport } from "./ConfirmImport";

export const metadata = { title: "Import preview" };

// The importer stores its reasons in English; show them in Hinglish (the original text stays in the tooltip).
const REASON: Record<string, string> = {
  "no email": "Email nahi hai",
  "invalid syntax": "Email ka format galat hai",
  suppressed: "Block list mein hai",
  "already contacted (in Firebase ledger)": "Pehle contact ho chuka hai (Ledger mein hai)",
  "already imported in an earlier list": "Pichhli kisi list mein pehle se hai",
  "marked as chain": "File mein chain mark kiya hai",
  "chain (3+ rows share this domain/email)": "Chain lagta hai: 3+ rows mein same domain/email",
  "business already contacted (in Firebase ledger)": "Is business se pehle contact ho chuka hai (Ledger)",
  "business already imported in an earlier list": "Ye business pichhli list mein pehle se hai",
  "no MX record": "Domain ka MX record nahi, mail nahi pahunchegi",
  "looks like a private person's address": "Kisi insaan ka personal address lagta hai",
  "already imported (race)": "Kisi doosri list se pehle hi import ho chuka hai",
  failed: "Add nahi ho paya",
};
function wajah(reason: string) {
  const role = reason.match(/^role address \((.+)\)$/);
  if (role) return `Role address hai (${role[1]}), kisi insaan ka nahi`;
  const dup = reason.match(/^duplicate business \(kept (.+)\)$/);
  if (dup) return `Same business ka doosra address (${dup[1]} rakha)`;
  return REASON[reason] || reason;
}

/** Phone version of a Stat tile: three fit in one row. */
function MiniStat({ href, label, value, dot, info, on }: { href: string; label: string; value: number; dot: string; info: string; on: boolean }) {
  return (
    <Link href={href} className={`card block !p-3 transition active:scale-[.98] ${on ? "!border-indigo-300 ring-2 ring-indigo-500/15" : ""}`}>
      <div className="flex items-center gap-1.5 text-2xs font-semibold text-slate-500">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 truncate">{label}</span>
        <Info text={info} title={label} size={12} />
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>
    </Link>
  );
}

export default async function ImportPreview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ f?: string }> }) {
  const id = (await params).id;
  const { f } = await searchParams;
  const ld = await C.lists.doc(id).get();
  if (!ld.exists) notFound();
  const list = { id, ...ld.data() } as LeadList;
  const c = list.counts || {};
  const q = f ? C.lists.doc(id).collection("rows").where("outcome", "==", f) : C.lists.doc(id).collection("rows");
  const items = rows<ImportRow>(await q.limit(1000).get()).sort((a, b) => a.rowNo - b.rowNo);

  const send = c.send || 0, review = c.review || 0, skip = c.skip || 0;
  const done = !!list.confirmed;
  const nothing = send + review === 0;
  // after confirm the 'send' rows are Ready leads, so the page stops saying "Bhejenge" (will send) for them
  const sendLabel = done ? "Ready" : "Bhejenge";
  const tabs = [{ f: "", label: "Sab", n: send + review + skip }, { f: "send", label: sendLabel, n: send }, { f: "review", label: "Review", n: review }, { f: "skip", label: "Skip", n: skip }];
  const tabBar = (
    <div className="seg">
      {tabs.map((t) => (
        <Link key={t.label} href={t.f ? `/import/${id}?f=${t.f}` : `/import/${id}`} scroll={false} className={`seg-item ${(f || "") === t.f ? "seg-item-on" : ""}`}>
          {t.label}<span className="tabular-nums text-slate-400">{t.n}</span>
        </Link>
      ))}
    </div>
  );
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const added = [send && `${send} Ready`, review && `${review} 'Review chahiye'`].filter(Boolean).join(" aur ");
  const steps = (short: boolean): { label: string; state: StepState }[] => [
    { label: short ? "File do" : "File ya text do", state: "done" },
    { label: short ? "Check karo" : "Match / check karo", state: "done" },
    { label: short ? "Confirm" : "Preview & confirm", state: done ? "done" : "current" },
  ];
  // list.counts are frozen at confirm; what happened to the leads after that is only on the Contacts page
  const snapshot = done ? "\nYe ginti confirm ke waqt ki hai. Leads ka abhi ka status Contacts mein dikhta hai." : "";
  const stats: { f: string; label: string; short: string; value: number; tone: Tone; icon: IconName; dot: string; sub: string; info: string }[] = [
    {
      f: "send", label: done ? "Ready hue" : "Bhejenge", short: sendLabel, value: send, tone: "emerald", icon: "send", dot: "bg-emerald-500", sub: done ? "Confirm par Ready bane" : "Confirm par Ready banenge",
      info: "Ye addresses saare checks pass kar chuke hain: sahi format, MX record, role address nahi, Ledger aur Block list mein nahi. Confirm par ye 'Ready' status ke saath Contacts mein jaate hain aur campaign mein use hote hain." + snapshot,
    },
    {
      f: "review", label: "Review chahiye", short: "Review", value: review, tone: "amber", icon: "eye", dot: "bg-amber-500", sub: done ? "Review status mein add hue" : "Aapke approval ke baad hi mail",
      info: "Ye kisi insaan ka personal address lagta hai (jaise naam.surname@ ya gmail). Confirm par ye 'Review chahiye' status mein add hote hain; Contacts mein khud dekh ke approve ya reject karo." + snapshot,
    },
    {
      f: "skip", label: done ? "Skip hue" : "Skip honge", short: "Skip", value: skip, tone: "slate", icon: "x-circle", dot: "bg-slate-400", sub: done ? "Add nahi hue" : "Kabhi add nahi honge",
      info: `Ye rows add nahi ${done ? "hui" : "hongi"}: email nahi ya galat, MX record nahi, role address, chain, duplicate business, Block list, ya pehle contact ho chuka. Har row ki wajah table mein hai.`,
    },
  ];

  return (
    <div>
      <PageHeader
        title={`${done ? "List" : "Preview"}: ${list.name}`}
        back={{ href: "/import", label: "Import" }}
        sub={`Kahan se mile: ${list.sourceNote} · ${fmt(list.createdAt)}`}
        info={done
          ? "Is list ki har row ka import result: Ready (saare checks pass, Ready status mein add hua), Review ('Review chahiye' status mein add hua) ya Skip (add nahi hua).\nTiles ya tabs se filter karo, aur 'Wajah' mein dekho kyun.\nYe ginti import ke waqt ki hai. Leads ka abhi ka status Contacts mein dikhta hai."
          : "Yahan dikhta hai ki file ki har row ka kya hoga: Bhejenge (saare checks pass), Review chahiye (aap khud dekhoge) ya Skip (add nahi hoga).\nTiles ya tabs se filter karo, aur 'Wajah' mein dekho kyun.\nConfirm karne par hi leads Contacts mein add hote hain; skip wale kabhi add nahi hote."}
        actions={done ? <Badge v="done" label="Import ho chuka" tone="emerald" /> : <Badge v="draft" label="Confirm baaki hai" tone="amber" />}
      />

      <div className="space-y-4">
        <div>
          <div className="sm:hidden"><Steps steps={steps(true)} /></div>
          <div className="hidden sm:block"><Steps steps={steps(false)} /></div>
        </div>

        {done && (
          <Callout tone="success" title="Ye list import ho chuki hai">
            {added ? `Contacts mein add hue: ${added}.` : "Is list se koi lead add nahi hua."}{skip ? ` ${plural(skip, "row", "rows")} skip hui.` : ""}
          </Callout>
        )}
        {!done && nothing && (
          <>
            <Callout tone="warn" title="Is list mein bhejne layak koi address nahi">Saari rows skip hongi, isliye confirm karne se kuch add nahi hoga. Wajah neeche table mein dekho.</Callout>
            <ToastOnMount kind="warning" title="Koi address bhejne layak nahi" text="Is list ki saari rows skip hongi. Doosri file import karke dekho." once={`import-empty:${id}`} />
          </>
        )}

        <div>
          <div className="grid grid-cols-3 gap-2 sm:hidden">
            {stats.map((s) => <MiniStat key={s.f} href={`/import/${id}?f=${s.f}`} label={s.short} value={s.value} dot={s.dot} info={s.info} on={f === s.f} />)}
          </div>
          <div className="hidden gap-3 sm:grid sm:grid-cols-3">
            {stats.map((s) => <Stat key={s.f} href={`/import/${id}?f=${s.f}`} label={s.label} value={s.value} tone={s.tone} icon={s.icon} sub={s.sub} info={s.info} />)}
          </div>
        </div>

        {done ? (
          // counts are from confirm time and the leads may have moved on since, so this is worded as history
          review > 0 ? (
            <NextStep href="/contacts?status=needs_review" cta="Review wale dekho"
              text={<>Import ke waqt {plural(review, "lead", "leads")} &apos;Review chahiye&apos; mein {review === 1 ? "gaya tha" : "gaye the"}. Agar abhi tak approve ya reject nahi kiya, to Contacts mein karo, phir campaign banao.</>} />
          ) : send > 0 ? (
            <NextStep href="/campaigns" cta="Campaigns kholo"
              text={<>Import ke waqt {plural(send, "lead", "leads")} Ready {send === 1 ? "bana tha" : "bane the"}. Agar is list se abhi tak campaign nahi banaya, to Campaigns page pe banao: pehle 5 sample mails banti hain, unhe approve karte hi campaign shuru hota hai.</>} />
          ) : (
            <NextStep tone="amber" href="/import" cta="Nayi list import karo" text="Is list se koi lead add nahi hua. Doosri file import karo." />
          )
        ) : nothing ? (
          <NextStep tone="amber" href="/import" cta="Doosri file import karo" text="Is list se kuch add nahi hoga. Doosri file try karo, ya confirm karke is list ko band kar do.">
            <ConfirmImport listId={id} review={review} expected={send + review} className="btn" />
          </NextStep>
        ) : (
          <NextStep text={<>Rows check karo, phir confirm karo. Confirm karne par sirf <b>&apos;Bhejenge&apos;</b> aur <b>&apos;Review&apos;</b> wale leads add honge; skip wale nahi.</>}>
            <ConfirmImport listId={id} review={review} expected={send + review} />
          </NextStep>
        )}

        <Section flush icon="list" title="Har row ka result" sub={`${plural(items.length, "row", "rows")} dikh rahi ${items.length === 1 ? "hai" : "hain"}${items.length >= 1000 ? " (sirf pehli 1000)" : ""}`}
          info={done
            ? "File ki har row aur uska import result. Ready = Ready status mein add hua, Review = 'Review chahiye' mein add hua, Skip = add nahi hua.\nTabs se filter karo. Ek baar mein max 1000 rows dikhti hain."
            : "File ki har row aur uska result. Bhejenge = add hoke campaign mein jayega, Review = aapke approval ke baad, Skip = add nahi hoga.\nTabs se filter karo. Ek baar mein max 1000 rows dikhti hain."}
          actions={<div className="max-sm:hidden">{tabBar}</div>}>
          {/* phones: the tabs get a row of their own; next to the title they squeeze it to one word per line */}
          <div className="border-b border-slate-100 px-4 py-2.5 sm:hidden">{tabBar}</div>
          {items.length ? (
            <div className="overflow-x-auto">
              <table className="tbl tbl-stack">
                <thead><tr><th className="w-12">#</th><th>Result</th><th>Wajah</th><th>Email</th><th>Business</th><th>Website</th><th>Desh</th></tr></thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Row" className="tabular-nums text-slate-400">{r.rowNo}</td>
                      <td data-label="Result"><Badge v={r.outcome} label={r.outcome === "send" ? sendLabel : undefined} /></td>
                      <td data-label="Wajah" className="text-xs text-slate-500" title={r.reason || undefined}>{r.reason ? wajah(r.reason) : r.outcome === "send" ? "Saare checks pass" : null}</td>
                      {/* only the stacked phone cards may break an address anywhere; in the desktop table it would squeeze the column */}
                      <td data-label="Email" className="font-medium text-slate-900 max-md:[overflow-wrap:anywhere]">{r.email}</td>
                      <td data-label="Business">{r.businessName}</td>
                      <td data-label="Website">{r.website && <span className="block min-w-0 max-w-[220px] truncate" title={r.website}>{r.website}</span>}</td>
                      <td data-label="Desh">{r.country}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : f ? (
            <EmptyState icon="filter" title="Is filter mein koi row nahi" text="Doosra tab chuno ya saari rows dekho." href={`/import/${id}`} cta="Saari rows dekho" />
          ) : (
            <EmptyState icon="file" title="Is list mein koi row nahi" text="Nayi file import karke dobara try karo." href="/import" cta="Nayi file import karo" />
          )}
        </Section>
      </div>
    </div>
  );
}
