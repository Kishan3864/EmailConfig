import Link from "next/link";
import { notFound } from "next/navigation";
import { C, rows, type ImportRow, type LeadList } from "@/lib/fsdb";
import { Badge } from "@/components/ui";
import { ConfirmImport } from "./ConfirmImport";

export default async function ImportPreview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ f?: string }> }) {
  const id = (await params).id;
  const { f } = await searchParams;
  const ld = await C.lists.doc(id).get();
  if (!ld.exists) notFound();
  const list = { id, ...ld.data() } as LeadList;
  const c = list.counts || {};
  const q = f ? C.lists.doc(id).collection("rows").where("outcome", "==", f) : C.lists.doc(id).collection("rows");
  const items = rows<ImportRow>(await q.limit(1000).get()).sort((a, b) => a.rowNo - b.rowNo);
  return (
    <div className="space-y-4">
      <h1 className="h1">Preview: {list.name}</h1>
      <div className="card flex flex-wrap items-center gap-4">
        <Link href={`/import/${id}?f=send`} className="text-emerald-700 font-medium">Will send: {c.send || 0}</Link>
        <Link href={`/import/${id}?f=review`} className="text-amber-700 font-medium">Needs review: {c.review || 0}</Link>
        <Link href={`/import/${id}?f=skip`} className="text-slate-600 font-medium">Skipped: {c.skip || 0}</Link>
        <Link href={`/import/${id}`} className="text-sm text-slate-500">All</Link>
        <span className="text-sm text-slate-500">Source: {list.sourceNote}</span>
        <div className="ml-auto">{list.confirmed ? <span className="badge">Confirmed</span> : <ConfirmImport listId={id} />}</div>
      </div>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>#</th><th>Outcome</th><th>Reason</th><th>Email</th><th>Business</th><th>Website</th><th>Country</th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}><td>{r.rowNo}</td><td><Badge v={r.outcome} /></td><td className="text-xs text-slate-500">{r.reason}</td><td>{r.email}</td><td>{r.businessName}</td><td className="max-w-[220px] truncate">{r.website}</td><td>{r.country}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
