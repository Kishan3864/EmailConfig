import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui";
import { fmt } from "@/lib/time";
import { approveLead, rejectLead, markCheckedSent, markCheckedNotSent } from "../../actions";

export default async function Contact({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const l = await prisma.lead.findUnique({
    where: { id },
    include: { message: true, replies: { orderBy: { receivedAt: "asc" } }, events: { orderBy: { at: "asc" } }, list: true, campaign: true },
  });
  if (!l) notFound();
  const sends = await prisma.sendLog.findMany({ where: { leadId: id }, orderBy: { at: "asc" } });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><h1 className="h1 mb-0">{l.businessName || l.email}</h1><Badge v={l.status} /></div>
      <div className="card grid md:grid-cols-3 gap-2 text-sm">
        <div><span className="label">Email</span>{l.email}</div>
        <div><span className="label">Website</span>{l.website || "—"}</div>
        <div><span className="label">Phone</span>{l.phone || "—"}</div>
        <div><span className="label">Country</span>{l.country || "—"}</div>
        <div><span className="label">List</span>{l.list.name} ({l.list.sourceNote})</div>
        <div><span className="label">Campaign</span>{l.campaign?.name || "—"}</div>
      </div>
      {l.status === "needs_review" && (
        <div className="card flex gap-2">
          <form action={approveLead.bind(null, id)}><button className="btn-primary">Approve</button></form>
          <form action={rejectLead.bind(null, id)}><button className="btn">Reject</button></form>
        </div>
      )}
      {l.status === "check_manual" && (
        <div className="card space-y-2 border-red-300">
          <p className="text-sm">The send result is uncertain. Check your Sent folder / mailbox. It will <b>never</b> be resent automatically.</p>
          <div className="flex gap-2">
            <form action={markCheckedSent.bind(null, id)}><button className="btn">It was sent</button></form>
            <form action={markCheckedNotSent.bind(null, id)}><button className="btn">It was not sent (close)</button></form>
          </div>
        </div>
      )}
      {l.facts && (
        <details className="card text-sm">
          <summary className="cursor-pointer font-medium">Homepage facts ({fmt(l.factsAt)})</summary>
          <pre className="text-xs mt-2 whitespace-pre-wrap">{JSON.stringify(JSON.parse(l.facts), null, 2)}</pre>
        </details>
      )}
      {l.message && (
        <div className="card grid md:grid-cols-2 gap-4">
          <div><span className="label">Message ({l.message.status})</span><div className="font-medium">{l.message.subject}</div><pre className="whitespace-pre-wrap text-sm font-sans mt-2">{l.message.body}</pre></div>
          {l.message.bodyEn && <div><span className="label">English</span><div className="font-medium">{l.message.subjectEn}</div><pre className="whitespace-pre-wrap text-sm font-sans mt-2">{l.message.bodyEn}</pre></div>}
        </div>
      )}
      {l.replies.length > 0 && (
        <div className="card space-y-3">
          <h2 className="h2">Inbound</h2>
          {l.replies.map((r) => (
            <div key={r.id} className="border-t pt-2">
              <div className="text-xs text-slate-500"><Badge v={r.kind} /> {r.fromEmail} · {fmt(r.receivedAt)} · {r.subject}</div>
              <pre className="whitespace-pre-wrap text-sm font-sans">{r.body.slice(0, 3000)}</pre>
              {r.bodyEn && <pre className="whitespace-pre-wrap text-sm font-sans text-indigo-900 bg-indigo-50 p-2 rounded mt-1">{r.bodyEn}</pre>}
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <h2 className="h2">History</h2>
        <table className="tbl"><tbody>
          {l.events.map((e) => <tr key={"e" + e.id}><td className="whitespace-nowrap">{fmt(e.at)}</td><td>{e.type}</td><td className="text-xs">{e.detail}</td></tr>)}
          {sends.map((s) => <tr key={"s" + s.id}><td className="whitespace-nowrap">{fmt(s.at)}</td><td>{s.dryRun ? "smtp (dry-run)" : "smtp"} {s.ok ? "✓" : "✗"}</td><td className="text-xs">{s.to}: {s.response}</td></tr>)}
        </tbody></table>
      </div>
    </div>
  );
}
