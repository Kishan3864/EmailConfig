import Link from "next/link";
import { C, rows, type SendLog } from "@/lib/fsdb";
import { DISPLAY_TZ, dayStart, fmt, partsIn, zoned } from "@/lib/time";
import { Badge, Stat } from "@/components/ui";

type Row = SendLog & { subject?: string; text?: string; withLogo?: boolean; business?: string; leadEmail?: string };

const dayKey = (d: Date) => partsIn(d, DISPLAY_TZ).dayKey;
function startOf(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return zoned(y, m, d, 0, 0, DISPLAY_TZ);
}

export default async function Sent({ searchParams }: { searchParams: Promise<{ day?: string; mode?: string }> }) {
  const { day, mode = "live" } = await searchParams;
  const today = dayKey(new Date());
  const key = /^\d{4}-\d{2}-\d{2}$/.test(day || "") ? day! : today;
  const from = startOf(key);
  const to = dayStart(new Date(from.getTime() + 36 * 3600000), DISPLAY_TZ);
  const prev = dayKey(new Date(from.getTime() - 12 * 3600000));
  const next = dayKey(new Date(to.getTime() + 12 * 3600000));

  const all = rows<Row>(await C.sendLogs.where("at", ">=", from.toISOString()).where("at", "<", to.toISOString()).orderBy("at", "desc").get());
  const live = all.filter((l) => !l.dryRun);
  const dry = all.filter((l) => l.dryRun);
  const shown = mode === "dry" ? dry : mode === "all" ? all : live;
  const tab = (m: string, label: string) => <Link href={`/sent?day=${key}&mode=${m}`} className={`btn ${mode === m ? "bg-slate-100" : ""}`}>{label}</Link>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="h1 mb-0 mr-2">Sent mails</h1>
        <Link href={`/sent?day=${prev}&mode=${mode}`} className="btn">←</Link>
        <span className="font-medium">{key}{key === today ? " (today)" : ""}</span>
        {key < today && <Link href={`/sent?day=${next}&mode=${mode}`} className="btn">→</Link>}
        <span className="text-sm text-slate-500">times in {DISPLAY_TZ}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Stat label="Sent to leads (live)" value={live.filter((l) => l.ok).length} />
        <Stat label="Dry-run (to your test address)" value={dry.filter((l) => l.ok).length} />
        <Stat label="Failed / not accepted" value={all.filter((l) => !l.ok).length} />
      </div>
      <div className="flex gap-2">{tab("live", "Live")}{tab("dry", "Dry-run")}{tab("all", "All")}</div>

      <div className="space-y-3">
        {shown.map((l) => (
          <details key={l.id} className="card">
            <summary className="cursor-pointer flex flex-wrap items-center gap-2 text-sm">
              <span className="whitespace-nowrap text-slate-500">{fmt(l.at)}</span>
              <Badge v={l.ok ? (l.dryRun ? "dry-run" : "sent") : "failed"} />
              <span className="font-medium">{l.business || l.leadEmail || l.to}</span>
              <span className="text-slate-500">{l.dryRun ? `${l.leadEmail} → test address` : l.to}</span>
              <span className="text-slate-700">— {l.subject || "(subject not recorded)"}</span>
            </summary>
            <div className="mt-3 space-y-2">
              <div className="text-xs text-slate-500">Subject</div>
              <div className="font-medium">{l.subject}</div>
              <pre className="whitespace-pre-wrap text-sm font-sans bg-slate-50 p-3 rounded">{l.text || "(text not recorded)"}</pre>
              {l.withLogo && <div className="text-xs text-slate-500">Sent with the logo in the signature.</div>}
              <div className="text-xs text-slate-500 font-mono">SMTP: {l.response}</div>
              {l.leadId && <Link href={`/contacts/${encodeURIComponent(l.leadId)}`} className="text-sm text-indigo-600">Contact history →</Link>}
            </div>
          </details>
        ))}
        {!shown.length && <div className="card text-sm text-slate-500">Nothing {mode === "dry" ? "dry-run" : mode === "all" ? "" : "sent to leads"} on this day.</div>}
      </div>
      <p className="text-xs text-slate-500">Every live mail also has a copy in your mailbox&apos;s Sent folder (Hostinger webmail).</p>
    </div>
  );
}
