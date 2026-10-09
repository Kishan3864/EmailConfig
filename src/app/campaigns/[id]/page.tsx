import Link from "next/link";
import { notFound } from "next/navigation";
import { C, count, rows, type Campaign, type Message, type LeadList } from "@/lib/fsdb";
import { getSettings } from "@/lib/settings";
import { estimateFinish, capFor, priorSendingDays } from "@/lib/schedule";
import { fullText } from "@/lib/sender";
import { fmt, fmtDate } from "@/lib/time";
import { Badge, Stat } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { samplesAction, startCampaign, pauseCampaign, resumeCampaign, regenerateDraft } from "../../actions";

const STATUSES = ["ready", "needs_review", "sent", "replied", "bounced", "opted_out", "check_manual", "already_contacted"];

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const cd = await C.campaigns.doc(id).get();
  if (!cd.exists) notFound();
  const c = { id, ...cd.data() } as Campaign;
  const list = (await C.lists.doc(c.listId).get()).data() as LeadList;
  const s = await getSettings();
  const counts: Record<string, number> = {};
  for (const st of STATUSES) counts[st] = await count(C.leads.where("campaignId", "==", id).where("status", "==", st));
  const remaining = counts.ready;
  const finish = c.status === "done" ? null : await estimateFinish(s, c.timezone, remaining);
  const cap = capFor(s, await priorSendingDays(c.timezone));
  const messages = rows<Message>(await C.messages.where("campaignId", "==", id).orderBy("createdAt", "desc").limit(c.samplesApproved ? 30 : 5).get());
  const failing = (await C.draftJobs.where("campaignId", "==", id).limit(10).get()).docs;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3"><h1 className="h1 mb-0">{c.name}</h1><Badge v={c.status} />{s.dryRun && <span className="badge bg-amber-100 text-amber-800">DRY RUN</span>}</div>
      <div className="grid md:grid-cols-4 gap-4">
        <Stat label="Remaining" value={remaining} sub={`needs review: ${counts.needs_review}`} />
        <Stat label="Sent" value={counts.sent + counts.replied + counts.bounced + counts.opted_out} sub={`replied ${counts.replied} · bounced ${counts.bounced} · opted out ${counts.opted_out}`} />
        <Stat label="Estimated finish" value={c.status === "done" ? "Finished" : fmtDate(finish)} sub={`today's cap ${cap}/day · ${s.windowStart}-${s.windowEnd} ${c.timezone}`} />
        <Stat label="Language / list" value={c.language.toUpperCase()} sub={`${list?.name} · source: ${list?.sourceNote}`} />
      </div>

      <div className="card flex flex-wrap gap-3 items-start">
        {!c.samplesApproved && <>
          <ActionButton action={samplesAction.bind(null, id)} label="1. Generate 5 sample drafts" />
          <ActionButton action={startCampaign.bind(null, id)} label="2. Approve samples & start" className="btn-primary" confirmText="Click again to approve & start" />
        </>}
        {c.status === "running" && <ActionButton action={pauseCampaign.bind(null, id)} label="Pause" />}
        {c.status === "paused" && <ActionButton action={resumeCampaign.bind(null, id)} label="Resume" className="btn-primary" />}
        {counts.check_manual > 0 && <Link className="btn text-red-700" href="/contacts?status=check_manual">{counts.check_manual} need manual check</Link>}
        {counts.already_contacted > 0 && <span className="badge">{counts.already_contacted} blocked by ledger (already contacted)</span>}
      </div>

      {failing.length > 0 && (
        <div className="card text-xs space-y-1">
          <div className="font-medium text-amber-700">Drafts waiting for retry</div>
          {failing.map((f) => <div key={f.id}>{decodeURIComponent(f.id)}: attempt {f.get("attempts")}, next {fmt(f.get("nextTryAt"))} — {f.get("lastError")}</div>)}
        </div>
      )}

      <h2 className="h2">{c.samplesApproved ? "Latest drafts & sent mails" : "Sample drafts for approval"}</h2>
      <div className="space-y-4">
        {messages.map((m) => (
          <div key={m.id} className="card">
            <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
              <Badge v={m.status} /><span className="font-medium">{m.businessName}</span><span className="text-slate-500">{m.leadEmail}</span>
              {m.sentAt && <span className="text-slate-500">sent {fmt(m.sentAt)}</span>}
              {m.dryRunDone && <span className="badge">dry-run delivered</span>}
              {m.status === "ready" && <span className="ml-auto"><ActionButton action={regenerateDraft.bind(null, m.id)} label="Regenerate" /></span>}
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-500">Subject</div><div className="font-medium mb-2">{m.subject}</div>
                <pre className="whitespace-pre-wrap text-sm font-sans bg-slate-50 p-3 rounded">{fullText(s, m.body, m.language, list?.sourceNote || "")}</pre>
              </div>
              {m.bodyEn && (
                <div>
                  <div className="text-xs text-slate-500">English translation</div><div className="font-medium mb-2">{m.subjectEn}</div>
                  <pre className="whitespace-pre-wrap text-sm font-sans bg-indigo-50/50 p-3 rounded">{m.bodyEn}</pre>
                </div>
              )}
            </div>
            {m.smtpResponse && <div className="text-xs text-slate-500 mt-2">SMTP: {m.smtpResponse}</div>}
            {m.error && <div className="text-xs text-red-600 mt-2">{m.error}</div>}
          </div>
        ))}
        {!messages.length && <p className="text-sm text-slate-500">No drafts yet.</p>}
      </div>
    </div>
  );
}
