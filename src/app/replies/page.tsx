import Link from "next/link";
import { C, rows, type Reply, type Message } from "@/lib/fsdb";
import { Badge } from "@/components/ui";
import { fmt } from "@/lib/time";

export default async function Replies({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const q = all ? C.replies.orderBy("receivedAt", "desc") : C.replies.where("kind", "in", ["reply", "optout"]).orderBy("receivedAt", "desc");
  const replies = rows<Reply>(await q.limit(200).get());
  const msgs = new Map<string, Message>();
  for (const id of [...new Set(replies.map((r) => r.leadId).filter(Boolean) as string[])]) {
    const m = await C.messages.doc(id).get();
    if (m.exists) msgs.set(id, { id, ...m.data() } as Message);
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="h1 mb-0">Replies</h1>
        <Link href={all ? "/replies" : "/replies?all=1"} className="text-sm text-indigo-600 ml-auto">{all ? "Only replies & opt-outs" : "Show bounces & auto-replies too"}</Link>
      </div>
      {replies.map((r) => {
        const m = r.leadId ? msgs.get(r.leadId) : undefined;
        return (
          <div key={r.id} className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge v={r.kind} />
              {r.leadId ? <Link href={`/contacts/${encodeURIComponent(r.leadId)}`} className="font-medium text-indigo-600">{m?.businessName || r.fromEmail}</Link> : r.fromEmail}
              <span className="text-slate-500">{r.fromEmail} · {fmt(r.receivedAt)}</span>
            </div>
            {m && (
              <details className="text-sm">
                <summary className="cursor-pointer text-slate-500">My mail: {m.subject} ({fmt(m.sentAt)})</summary>
                <pre className="whitespace-pre-wrap font-sans bg-slate-50 p-2 rounded mt-1">{m.body}</pre>
                {m.bodyEn && <pre className="whitespace-pre-wrap font-sans bg-indigo-50 p-2 rounded mt-1">{m.bodyEn}</pre>}
              </details>
            )}
            <div className="grid md:grid-cols-2 gap-4">
              <div><div className="text-xs text-slate-500">{r.subject}</div><pre className="whitespace-pre-wrap text-sm font-sans">{r.body.slice(0, 4000)}</pre></div>
              {r.bodyEn && <div><div className="text-xs text-slate-500">English</div><pre className="whitespace-pre-wrap text-sm font-sans bg-indigo-50 p-2 rounded">{r.bodyEn}</pre></div>}
            </div>
          </div>
        );
      })}
      {!replies.length && <p className="text-sm text-slate-500">No replies yet. The worker syncs the inbox every 10 minutes.</p>}
    </div>
  );
}
