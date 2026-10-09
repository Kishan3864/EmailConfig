import Link from "next/link";
import { C, count, rows, type Campaign } from "@/lib/fsdb";
import { getSettings, getState } from "@/lib/settings";
import { capFor, priorSendingDays, sentToday, estimateFinish, nextWindowOpen } from "@/lib/schedule";
import { fmt, fmtDate } from "@/lib/time";
import { Stat, Badge } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { globalStopAction, clearStopAction } from "./actions";

export default async function Dashboard() {
  const s = await getSettings();
  const st = await getState();
  const active = rows<Campaign>(await C.campaigns.where("status", "in", ["running", "paused", "draft"]).get()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const tz = active.find((c) => c.status === "running")?.timezone || active[0]?.timezone || "Europe/Paris";
  const cap = capFor(s, await priorSendingDays(tz));
  const today = await sentToday(tz);
  const runningIds = active.filter((c) => c.status === "running").map((c) => c.id);
  const queue = runningIds.length ? await count(C.leads.where("campaignId", "in", runningIds.slice(0, 30)).where("status", "==", "ready")) : 0;
  const byStatus = async (status: string) => count(C.leads.where("status", "==", status));
  const [sent, replied, bounced, optedOut, review, manual, ledger] = await Promise.all([
    count(C.messages.where("status", "in", ["sent", "bounced"])), byStatus("replied"), byStatus("bounced"), byStatus("opted_out"), byStatus("needs_review"), byStatus("check_manual"), count(C.contacted),
  ]);
  const last50 = (await C.messages.orderBy("sentAt", "desc").limit(50).get()).docs.map((d) => d.get("status"));
  const bounceRate = last50.length ? last50.filter((x) => x === "bounced").length / last50.length : 0;
  const workerAlive = st.lastWorkerTick && Date.now() - new Date(st.lastWorkerTick).getTime() < 6 * 60000;

  const stopped = st.globalStop || !!st.alert;
  const issues: string[] = [];
  if (st.alert) issues.push(`ALERT: ${st.alert.message}`);
  if (st.globalStop) issues.push("Global stop is on");
  if (!workerAlive) issues.push("Worker has not run in the last 6 minutes (Cloud Function / local worker)");
  if (st.dns && (!st.dns.spf || !st.dns.dkim)) issues.push("SPF or DKIM missing");
  if (!st.dns) issues.push("DNS not checked yet (Settings)");
  if (bounceRate > 0.02) issues.push(`Bounce rate ${(bounceRate * 100).toFixed(1)}%`);
  if (manual) issues.push(`${manual} sends need a manual check`);
  if (s.dryRun) issues.push("Dry-run mode is on (mails go only to your test address)");
  const health = st.alert || st.globalStop || (st.dns && (!st.dns.spf || !st.dns.dkim)) ? "red" : issues.length ? "amber" : "green";
  const color = { red: "bg-red-500", amber: "bg-amber-400", green: "bg-emerald-500" }[health];

  let next: Date | null = null;
  if (!stopped && queue > 0) {
    const gap = st.nextSendAt ? new Date(st.nextSendAt) : new Date();
    next = nextWindowOpen(gap > new Date() ? gap : new Date(), s, tz);
  }

  let ahead = 0;
  const progress = [];
  for (const c of active) {
    const total = await count(C.leads.where("campaignId", "==", c.id));
    const remaining = await count(C.leads.where("campaignId", "==", c.id).where("status", "==", "ready"));
    const rev = await count(C.leads.where("campaignId", "==", c.id).where("status", "==", "needs_review"));
    const finish = await estimateFinish(s, c.timezone, remaining, ahead);
    if (c.status === "running") ahead += remaining;
    progress.push({ c, total, done: total - remaining - rev, remaining, finish });
  }

  return (
    <div className="space-y-6">
      {st.alert && (
        <div className="rounded-xl bg-red-600 text-white p-4">
          <div className="font-semibold">Sending auto-paused</div><div className="text-sm">{st.alert.message} · {fmt(st.alert.at)}</div>
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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Stat label="Total sent" value={sent} />
        <Stat label="Replied" value={replied} />
        <Stat label="Bounced" value={bounced} sub={`last 50: ${(bounceRate * 100).toFixed(1)}%`} />
        <Stat label="Opted out" value={optedOut} />
        <Stat label="Contacted ledger" value={<Link href="/ledger" className="text-indigo-600">{ledger}</Link>} sub="never emailed again" />
      </div>

      <div className="card overflow-x-auto">
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
