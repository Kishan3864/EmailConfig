import { C, key, count, rows, type Contacted } from "@/lib/fsdb";
import { fmt } from "@/lib/time";
import { ActionButton } from "@/components/ActionButton";
import { importSentAction } from "../actions";
import { AddContacted } from "./AddContacted";

export default async function Ledger({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const total = await count(C.contacted);
  let items: Contacted[];
  if (q.includes("@")) {
    const d = await C.contacted.doc(key(q)).get();
    items = d.exists ? [{ id: d.id, ...d.data() } as Contacted] : [];
  } else items = rows<Contacted>(await C.contacted.orderBy("at", "desc").limit(300).get());
  return (
    <div className="space-y-4">
      <h1 className="h1">Contacted ledger <span className="text-sm font-normal text-slate-500">({total} addresses, stored in Firebase, never deleted)</span></h1>
      <div className="card text-sm text-slate-600 space-y-1">
        <p>Every address the app has ever emailed is here. Before every send, the app checks this list inside a database transaction. An address on it never gets a second cold mail, from any list or campaign.</p>
        <p>Add people you already emailed yourself, or import every recipient from your mailbox's Sent folder.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <AddContacted />
        <div className="card space-y-3">
          <h2 className="h2">Import from Sent folder</h2>
          <p className="text-sm text-slate-500">Reads every To/Cc/Bcc address in your mailbox&apos;s Sent folder and adds it to the ledger.</p>
          <ActionButton action={importSentAction} label="Import Sent folder recipients" />
        </div>
      </div>
      <form className="card flex gap-3">
        <input name="q" defaultValue={q} placeholder="Check an email address: was it ever contacted?" className="input max-w-md" />
        <button className="btn-primary">Check</button>
        {q && <span className="text-sm self-center">{items.length ? "YES, already contacted: it will never be emailed again." : "Not in the ledger."}</span>}
      </form>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Email</th><th>Status</th><th>Source</th><th>First contacted</th><th>Note</th></tr></thead>
          <tbody>{items.map((r) => <tr key={r.id}><td>{r.email}</td><td>{r.status}</td><td>{r.source}</td><td>{fmt(r.at)}</td><td className="text-xs">{r.note}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
