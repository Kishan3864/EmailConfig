import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui";
import { fmt } from "@/lib/time";

export default async function Logs({ searchParams }: { searchParams: Promise<{ tab?: string; level?: string }> }) {
  const { tab = "logs", level } = await searchParams;
  const sends = tab === "smtp" ? await prisma.sendLog.findMany({ orderBy: { id: "desc" }, take: 500 }) : [];
  const logs = tab === "smtp" ? [] : await prisma.log.findMany({ where: level ? { level } : {}, orderBy: { id: "desc" }, take: 500 });
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <h1 className="h1 mb-0 mr-4">Logs</h1>
        <Link href="/logs" className={`btn ${tab === "logs" ? "bg-slate-100" : ""}`}>App log</Link>
        <Link href="/logs?tab=smtp" className={`btn ${tab === "smtp" ? "bg-slate-100" : ""}`}>SMTP responses</Link>
        {tab === "logs" && <Link href="/logs?level=error" className="btn">Errors only</Link>}
      </div>
      <div className="card overflow-x-auto">
        {tab === "smtp" ? (
          <table className="tbl">
            <thead><tr><th>Time</th><th>To</th><th>OK</th><th>Mode</th><th>Full SMTP response</th></tr></thead>
            <tbody>{sends.map((s) => (
              <tr key={s.id}><td className="whitespace-nowrap">{fmt(s.at)}</td><td>{s.to}</td><td>{s.ok ? "✓" : "✗"}</td><td>{s.dryRun ? "dry-run" : "live"}</td><td className="text-xs font-mono">{s.response}</td></tr>
            ))}</tbody>
          </table>
        ) : (
          <table className="tbl">
            <thead><tr><th>Time</th><th>Level</th><th>Scope</th><th>Message</th></tr></thead>
            <tbody>{logs.map((l) => (
              <tr key={l.id}><td className="whitespace-nowrap">{fmt(l.at)}</td><td><Badge v={l.level} /></td><td>{l.scope}</td><td className="text-xs font-mono whitespace-pre-wrap">{l.message}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
