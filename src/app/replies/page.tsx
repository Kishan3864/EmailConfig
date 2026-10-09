import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui";
import { fmt } from "@/lib/time";

export default async function Replies({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const replies = await prisma.reply.findMany({
    where: all ? {} : { kind: { in: ["reply", "optout"] } },
    orderBy: { receivedAt: "desc" }, take: 200,
    include: { lead: { include: { message: true } } },
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="h1 mb-0">Replies</h1>
        <Link href={all ? "/replies" : "/replies?all=1"} className="text-sm text-indigo-600 ml-auto">{all ? "Only replies & opt-outs" : "Show bounces & auto-replies too"}</Link>
      </div>
      {replies.map((r) => (
        <div key={r.id} className="card space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge v={r.kind} />
            {r.lead ? <Link href={`/contacts/${r.lead.id}`} className="font-medium text-indigo-600">{r.lead.businessName || r.lead.email}</Link> : r.fromEmail}
            <span className="text-slate-500">{r.fromEmail} · {fmt(r.receivedAt)}</span>
          </div>
          {r.lead?.message && (
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-500">My mail: {r.lead.message.subject} ({fmt(r.lead.message.sentAt)})</summary>
              <pre className="whitespace-pre-wrap font-sans bg-slate-50 p-2 rounded mt-1">{r.lead.message.body}</pre>
              {r.lead.message.bodyEn && <pre className="whitespace-pre-wrap font-sans bg-indigo-50 p-2 rounded mt-1">{r.lead.message.bodyEn}</pre>}
            </details>
          )}
          <div className="grid md:grid-cols-2 gap-4">
            <div><div className="text-xs text-slate-500">{r.subject}</div><pre className="whitespace-pre-wrap text-sm font-sans">{r.body.slice(0, 4000)}</pre></div>
            {r.bodyEn && <div><div className="text-xs text-slate-500">English</div><pre className="whitespace-pre-wrap text-sm font-sans bg-indigo-50 p-2 rounded">{r.bodyEn}</pre></div>}
          </div>
        </div>
      ))}
      {!replies.length && <p className="text-sm text-slate-500">No replies yet. The worker syncs the inbox every 10 minutes.</p>}
    </div>
  );
}
