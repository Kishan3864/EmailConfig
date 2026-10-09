import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSettings, getState } from "@/lib/settings";
import { capFor, priorSendingDays, sentToday, estimateFinish, nextWindowOpen } from "@/lib/schedule";
import { fmt, fmtDate } from "@/lib/time";
import { Stat, Badge } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { globalStopAction, clearStopAction } from "./actions";

export default async function Dashboard() {
  const s = await getSettings();
  const st = await getState();
  const running = await prisma.campaign.findMany({ where: { status: { in: ["running", "paused", "draft"] } }, orderBy: { id: "asc" } });
  const tz = running.find((c) => c.status === "running")?.timezone || running[0]?.timezone || "Europe/Paris";
  const cap = capFor(s, await priorSendingDays(tz));
  const today = await sentToday(tz);
  const queue = await prisma.lead.count({ where: { status: "ready", campaign: { status: "running" } } });
  const [sent, replied, bounced, optedOut, review, manual] = await Promise.all([
    prisma.message.count({ where: { sentAt: { not: null } } }),
    prisma.lead.count({ where: { status: "replied" } }),
    prisma.lead.count({ where: { status: "bounced" } }),
    prisma.lead.count({ where: { status: "opted_out" } }),
    prisma.lead.count({ where: { status: "needs_review" } }),
    prisma.lead.count({ where: { status: "check_manual" } }),
  ]);
  const last50 = await prisma.message.findMany({ where: { sentAt: { not: null } }, orderBy: { sentAt: "desc" }, take: 50, select: { status: true } });
  const bounceRate = last50.length ? last50.filter((m) => m.status === "bounced").length / last50.length : 0;
  const workerAlive = st.lastWorkerTick && Date.now() - new Date(st.lastWorkerTick).getTime() < 120000;

  const stopped = st.globalStop || !!st.alert;
  const issues: string[] = [];
  if (st.alert) issues.push(`ALERT: ${st.alert.message}`);
  if (st.globalStop) issues.push("Global stop is on");
  if (!workerAlive) issues.push("Worker not running (pm2 start ecosystem.config.js)");
  if (st.dns && (!st.dns.spf || !st.dns.dkim)) issues.push("SPF or DKIM missing");
  if (!st.dns) issues.push("DNS not checked yet (Settings)");
  if (bounceRate > 0.02) issues.push(`Bounce rate ${(bounceRate * 100).toFixed(1)}%`);
  if (manual) issues.push(`${manual} sends need a manual check`);
  if (s.dryRun) issues.push("Dry-run mode is on");
  const health = st.alert || st.globalStop || (st.dns && (!st.dns.spf || !st.dns.dkim)) ? "red" : issues.length ? "amber" : "green";
  const color = { red: "bg-red-500", amber: "bg-amber-400", green: "bg-emerald-500" }[health];

  let next: Date | null = null;
  if (!stopped && queue > 0) {
    const gap = st.nextSendAt ? new Date(st.nextSendAt) : new Date();
    next = nextWindowOpen(gap > new Date() ? gap : new Date(), s, tz);
  }

  let ahead = 0;
  const progress = [];
  for (const c of running) {
    const counts = Object.fromEntries((await prisma.lead.groupBy({ by: ["status"], where: { campaignId: c.id }, _count: true })).map((x) => [x.status, x._count]));
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const remaining = counts.ready || 0;
    const finish = await estimateFinish(s, c.timezone, remaining, ahead);
    if (c.status === "running") ahead += remaining;
    progress.push({ c, total, done: total - remaining - (counts.needs_review || 0), remaining, finish });
  }

  return (
    <div className="space-y-6">
      {st.alert && (
        <div className="rounded-xl bg-red-600 text-white p-4 flex flex-wrap items-center gap-4">
          <div><div className="font-semibold">Sending auto-paused</div><div className="text-sm">{st.alert.message} · {fmt(st.alert.at)}</div></div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1 mb-0">Dashboard</h1>
        <span className={`w-3 h-3 rounded-full ${color}`} title={health} />
        <span className="text-sm text-slate-500">Times in Asia/Kolkata</span>
        <div className="ml-auto flex gap-2 items-start">
          {stopped
            ? <ActionButton action={clearStopAction} label="Clear stop / alert" confirmText="Click again: I fixed the cause" />
            : <ActionButton action={globalStopAction} label="■ STOP ALL SENDING" className="btn-danger" />}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Today sent / cap" value={`${today} / ${cap}`} sub={`warm-up · max ${Math.floor(s.planDailyLimit * 0.4)} (40% of plan)`} />
        <Stat label="Next send" value={stopped ? "stopped" : next ? fmt(next) : "—"} sub={`${s.windowStart}-${s.windowEnd} ${tz}`} />
        <Stat label="Queue" value={queue} sub={review ? <Link href="/contacts?status=needs_review" className="text-amber-700">{review} need review</Link> : "in running campaigns"} />
        <Stat label="Health" value={<span className="capitalize">{health}</span>} sub={workerAlive ? `worker ok · inbox sync ${fmt(st.lastSyncAt)}` : "worker offline"} />
      </div>
      {issues.length > 0 && <div className="card text-sm space-y-1">{issues.map((i) => <div key={i}>• {i}</div>)}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Total sent" value={sent} />
        <Stat label="Replied" value={replied} />
        <Stat label="Bounced" value={bounced} sub={`last 50: ${(bounceRate * 100).toFixed(1)}%`} />
        <Stat label="Opted out" value={optedOut} />
      </div>

      <div className="card">
        <h2 className="h2">Campaigns</h2>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Status</th><th>Progress</th><th>Remaining</th><th>Est. finish</th></tr></thead>
          <tbody>
            {progress.map(({ c, total, done, remaining, finish }) => (
              <tr key={c.id}>
                <td><Link href={`/campaigns/${c.id}`} className="text-indigo-600">{c.name}</Link></td><td><Badge v={c.status} /></td>
                <td className="w-1/3"><div className="h-2 bg-slate-100 rounded"><div className="h-2 bg-indigo-500 rounded" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div><span className="text-xs text-slate-500">{done}/{total}</span></td>
                <td>{remaining}</td><td>{fmtDate(finish)}</td>
              </tr>
            ))}
            {!progress.length && <tr><td colSpan={5} className="text-slate-500">No active campaigns.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
