import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui";
import { fmt } from "@/lib/time";
import { approveLead, rejectLead } from "../actions";

const STATUSES = ["ready", "needs_review", "sent", "replied", "bounced", "opted_out", "check_manual", "failed", "suppressed", "rejected"];

export default async function Contacts({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { q = "", status = "", page = "1" } = await searchParams;
  const p = Math.max(1, +page || 1);
  const where = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ email: { contains: q } }, { businessName: { contains: q } }, { website: { contains: q } }] } : {}),
  };
  const [leads, total] = await Promise.all([
    prisma.lead.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (p - 1) * 100, take: 100, include: { campaign: true } }),
    prisma.lead.count({ where }),
  ]);
  const qs = (o: Record<string, string>) => "?" + new URLSearchParams({ q, status, ...o }).toString();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="h1 mb-0">Contacts</h1><span className="text-sm text-slate-500">{total}</span>
        <a href={`/api/export${qs({})}`} className="btn ml-auto">Export CSV</a>
      </div>
      <form className="card flex flex-wrap gap-3">
        <input name="q" defaultValue={q} placeholder="Search email, business, website" className="input max-w-sm" />
        <select name="status" defaultValue={status} className="input max-w-[200px]"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <button className="btn-primary">Filter</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Email</th><th>Business</th><th>Website</th><th>Status</th><th>Campaign</th><th>Updated</th><th></th></tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td><Link href={`/contacts/${l.id}`} className="text-indigo-600">{l.email}</Link></td>
                <td>{l.businessName}</td><td className="max-w-[200px] truncate">{l.website}</td><td><Badge v={l.status} /></td>
                <td>{l.campaign?.name || "—"}</td><td className="whitespace-nowrap">{fmt(l.updatedAt)}</td>
                <td className="whitespace-nowrap">{l.status === "needs_review" && (
                  <span className="flex gap-1">
                    <form action={approveLead.bind(null, l.id)}><button className="btn py-1 text-emerald-700">Approve</button></form>
                    <form action={rejectLead.bind(null, l.id)}><button className="btn py-1 text-red-700">Reject</button></form>
                  </span>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-2 mt-3">
          {p > 1 && <Link className="btn" href={qs({ page: String(p - 1) })}>← Prev</Link>}
          {p * 100 < total && <Link className="btn" href={qs({ page: String(p + 1) })}>Next →</Link>}
        </div>
      </div>
    </div>
  );
}
