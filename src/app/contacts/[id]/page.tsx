import { notFound } from "next/navigation";
import { C, key, rows, type Lead, type Message, type Reply, type SendLog, type EventRow, type LeadList, type Campaign } from "@/lib/fsdb";
import { Badge } from "@/components/ui";
import { fmt } from "@/lib/time";
import { approveLead, rejectLead, markCheckedSent, markCheckedNotSent } from "../../actions";

export default async function Contact({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const ld = await C.leads.doc(id).get();
  if (!ld.exists) notFound();
  const l = { id, ...ld.data() } as Lead;
  const [md, list, camp, ledger] = await Promise.all([
    C.messages.doc(id).get(), C.lists.doc(l.listId).get(), l.campaignId ? C.campaigns.doc(l.campaignId).get() : null, C.contacted.doc(key(l.email)).get(),
  ]);
  const m = md.exists ? ({ id, ...md.data() } as Message) : null;
  const replies = rows<Reply>(await C.replies.where("leadId", "==", id).get()).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const events = rows<EventRow>(await C.leads.doc(id).collection("events").orderBy("at").get());
  const sends = rows<SendLog>(await C.sendLogs.where("leadId", "==", id).get()).sort((a, b) => a.at.localeCompare(b.at));
  const ls = list.data() as LeadList | undefined;
  const cn = camp?.exists ? (camp.data() as Campaign).name : "—";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><h1 className="h1 mb-0">{l.businessName || l.email}</h1><Badge v={l.status} /></div>
      <div className="card grid md:grid-cols-3 gap-2 text-sm">
        <div><span className="label">Email</span>{l.email}</div>
        <div><span className="label">Website</span>{l.website || "—"}</div>
        <div><span className="label">Phone</span>{l.phone || "—"}</div>
        <div><span className="label">Country</span>{l.country || "—"}</div>
        <div><span className="label">List</span>{ls?.name} ({ls?.sourceNote})</div>
        <div><span className="label">Campaign</span>{cn}</div>
        <div className="md:col-span-3"><span className="label">Contacted ledger (Firebase)</span>{ledger.exists ? `${ledger.get("status")} · first claimed ${fmt(ledger.get("at"))} · never emailed again` : "not contacted yet"}</div>
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
      {m && (
        <div className="card grid md:grid-cols-2 gap-4">
          <div><span className="label">Message ({m.status})</span><div className="font-medium">{m.subject}</div><pre className="whitespace-pre-wrap text-sm font-sans mt-2">{m.body}</pre></div>
          {m.bodyEn && <div><span className="label">English</span><div className="font-medium">{m.subjectEn}</div><pre className="whitespace-pre-wrap text-sm font-sans mt-2">{m.bodyEn}</pre></div>}
        </div>
      )}
      {replies.length > 0 && (
        <div className="card space-y-3">
          <h2 className="h2">Inbound</h2>
          {replies.map((r) => (
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
          {events.map((e) => <tr key={"e" + e.id}><td className="whitespace-nowrap">{fmt(e.at)}</td><td>{e.type}</td><td className="text-xs">{e.detail}</td></tr>)}
          {sends.map((s) => <tr key={"s" + s.id}><td className="whitespace-nowrap">{fmt(s.at)}</td><td>{s.dryRun ? "smtp (dry-run)" : "smtp"} {s.ok ? "✓" : "✗"}</td><td className="text-xs">{s.to}: {s.response}</td></tr>)}
        </tbody></table>
      </div>
    </div>
  );
}
