import Link from "next/link";
import { C, rows, type Lead, type Campaign } from "@/lib/fsdb";
import { Badge } from "@/components/ui";
import { fmt } from "@/lib/time";
import { approveLead, rejectLead } from "../actions";

const STATUSES = ["ready", "needs_review", "sent", "replied", "bounced", "opted_out", "check_manual", "failed", "suppressed", "rejected", "already_contacted"];
const PAGE = 100;

export default async function Contacts({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { q = "", status = "", page = "1" } = await searchParams;
  const p = Math.max(1, +page || 1);
  const base = status ? C.leads.where("status", "==", status) : C.leads;
  let leads = rows<Lead>(await base.orderBy("updatedAt", "desc").limit(q ? 5000 : p * PAGE + 1).get());
  if (q) leads = leads.filter((l) => `${l.email} ${l.businessName || ""} ${l.website || ""}`.toLowerCase().includes(q.toLowerCase()));
  const more = leads.length > p * PAGE;
  leads = leads.slice((p - 1) * PAGE, p * PAGE);
  const camps = new Map(rows<Campaign>(await C.campaigns.get()).map((c) => [c.id, c.name]));
  const qs = (o: Record<string, string>) => "?" + new URLSearchParams({ q, status, ...o }).toString();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="h1 mb-0">Contacts</h1>
        <a href={`/api/export${qs({})}`} className="btn ml-auto">Export CSV</a>
      </div>
      <form className="card flex flex-wrap gap-3">
        <input name="q" defaultValue={q} placeholder="Search email, business, website" className="input max-w-sm" />
        <select name="status" defaultValue={status} className="input max-w-[220px]"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <button className="btn-primary">Filter</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Email</th><th>Business</th><th>Website</th><th>Status</th><th>Campaign</th><th>Updated</th><th></th></tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td><Link href={`/contacts/${encodeURIComponent(l.id)}`} className="text-indigo-600">{l.email}</Link></td>
                <td>{l.businessName}</td><td className="max-w-[200px] truncate">{l.website}</td><td><Badge v={l.status} /></td>
                <td>{l.campaignId ? camps.get(l.campaignId) : "—"}</td><td className="whitespace-nowrap">{fmt(l.updatedAt)}</td>
                <td className="whitespace-nowrap">{l.status === "needs_review" && (
                  <span className="flex gap-1">
                    <form action={approveLead.bind(null, l.id)}><button className="btn py-1 text-emerald-700">Approve</button></form>
                    <form action={rejectLead.bind(null, l.id)}><button className="btn py-1 text-red-700">Reject</button></form>
                  </span>
                )}</td>
              </tr>
            ))}
            {!leads.length && <tr><td colSpan={7} className="text-slate-500">No contacts.</td></tr>}
          </tbody>
        </table>
        <div className="flex gap-2 mt-3">
          {p > 1 && <Link className="btn" href={qs({ page: String(p - 1) })}>← Prev</Link>}
          {more && <Link className="btn" href={qs({ page: String(p + 1) })}>Next →</Link>}
        </div>
      </div>
    </div>
  );
}
