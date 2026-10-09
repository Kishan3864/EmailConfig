import { prisma } from "@/lib/db";
import { fmt } from "@/lib/time";
import { addSuppression } from "../actions";

export default async function Suppression() {
  const rows = await prisma.suppression.findMany({ orderBy: { id: "desc" }, take: 1000 });
  return (
    <div className="space-y-4">
      <h1 className="h1">Suppression list <span className="text-sm font-normal text-slate-500">({rows.length}, permanent)</span></h1>
      <form action={addSuppression} className="card space-y-3">
        <textarea name="values" className="input" rows={3} placeholder="Emails or whole domains, separated by spaces, commas or new lines" required />
        <input name="reason" className="input" placeholder="Reason (optional)" />
        <button className="btn-primary">Add to suppression</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Value</th><th>Kind</th><th>Reason</th><th>Added</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{r.value}</td><td>{r.kind}</td><td>{r.reason}</td><td>{fmt(r.createdAt)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
