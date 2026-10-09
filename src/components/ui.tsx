const COLORS: Record<string, string> = {
  ready: "bg-sky-100 text-sky-800", needs_review: "bg-amber-100 text-amber-800", rejected: "bg-slate-200 text-slate-600",
  sent: "bg-emerald-100 text-emerald-800", replied: "bg-violet-100 text-violet-800", bounced: "bg-red-100 text-red-800",
  opted_out: "bg-orange-100 text-orange-800", check_manual: "bg-red-100 text-red-800", failed: "bg-red-100 text-red-800",
  suppressed: "bg-slate-200 text-slate-600", running: "bg-emerald-100 text-emerald-800", paused: "bg-amber-100 text-amber-800",
  draft: "bg-slate-100 text-slate-700", done: "bg-indigo-100 text-indigo-800", send: "bg-emerald-100 text-emerald-800",
  skip: "bg-slate-200 text-slate-600", review: "bg-amber-100 text-amber-800", retry: "bg-amber-100 text-amber-800",
  info: "bg-slate-100 text-slate-700", warn: "bg-amber-100 text-amber-800", error: "bg-red-100 text-red-800",
  reply: "bg-violet-100 text-violet-800", optout: "bg-orange-100 text-orange-800", bounce: "bg-red-100 text-red-800", auto: "bg-slate-100 text-slate-600",
};
export function Badge({ v }: { v: string }) {
  return <span className={`badge ${COLORS[v] || ""}`}>{v.replace(/_/g, " ")}</span>;
}
export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
