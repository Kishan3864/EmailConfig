import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui";
import { ConfirmImport } from "./ConfirmImport";

export default async function ImportPreview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ f?: string }> }) {
  const id = Number((await params).id);
  const { f } = await searchParams;
  const list = await prisma.leadList.findUnique({ where: { id } });
  if (!list) notFound();
  const counts = await prisma.importRow.groupBy({ by: ["outcome"], where: { listId: id }, _count: true });
  const c = Object.fromEntries(counts.map((x) => [x.outcome, x._count]));
  const rows = await prisma.importRow.findMany({ where: { listId: id, ...(f ? { outcome: f } : {}) }, orderBy: { rowNo: "asc" }, take: 1000 });
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
            {rows.map((r) => (
              <tr key={r.id}><td>{r.rowNo}</td><td><Badge v={r.outcome} /></td><td className="text-xs text-slate-500">{r.reason}</td><td>{r.email}</td><td>{r.businessName}</td><td className="max-w-[220px] truncate">{r.website}</td><td>{r.country}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
