"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Row = { email?: string; businessName?: string; website?: string; phone?: string; country?: string; chain?: string };
const FIELDS: [keyof Row, string][] = [["email", "Email *"], ["businessName", "Business name"], ["website", "Website"], ["phone", "Phone"], ["country", "Country"], ["chain", "Chain flag"]];

const GUESS: Record<keyof Row, RegExp> = {
  email: /e-?mail|courriel|mail/i, businessName: /business|company|name|nom|soci[ée]t[ée]|entreprise|title/i, website: /web|site|url|domain/i,
  phone: /phone|t[ée]l|mobile/i, country: /country|pays|land/i, chain: /chain|cha[iî]ne|franchise/i,
};

export default function ImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [listName, setListName] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [table, setTable] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [extracted, setExtracted] = useState<Row[] | null>(null);
  const [map, setMap] = useState<Partial<Record<keyof Row, number>>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function parse() {
    setErr(""); setBusy(true);
    const fd = new FormData();
    if (file) fd.append("file", file);
    fd.append("text", text);
    const r = await fetch("/api/import/parse", { method: "POST", body: fd });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error);
    if (!listName && file) setListName(file.name.replace(/\.\w+$/, ""));
    if (j.kind === "table") {
      setTable({ headers: j.headers, rows: j.rows }); setExtracted(null);
      const m: Partial<Record<keyof Row, number>> = {};
      for (const [f] of FIELDS) { const i = j.headers.findIndex((h: string) => GUESS[f].test(h)); if (i >= 0 && !Object.values(m).includes(i)) m[f] = i; }
      setMap(m);
    } else { setExtracted(j.rows); setTable(null); }
  }

  async function preview() {
    setErr("");
    let rows: Row[] = extracted || [];
    if (table) {
      if (map.email === undefined) return setErr("Map the email column");
      rows = table.rows.map((r) => Object.fromEntries(FIELDS.filter(([f]) => map[f] !== undefined).map(([f]) => [f, r[map[f]!] ?? ""])) as Row);
    }
    setBusy(true);
    const r = await fetch("/api/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listName, sourceNote, rows }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error);
    router.push(`/import/${j.listId}`);
  }

  return (
    <div className="space-y-6">
      <h1 className="h1">Import leads</h1>
      <div className="card space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <label><span className="label">List name</span><input className="input" value={listName} onChange={(e) => setListName(e.target.value)} /></label>
          <label><span className="label">Where did you find these addresses? * (shown in the footer, e.g. &quot;Google Maps&quot;, &quot;your website&quot;, &quot;PagesJaunes&quot;)</span><input className="input" value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} /></label>
        </div>
        <label className="block"><span className="label">File: CSV, XLSX, PDF or TXT</span><input type="file" accept=".csv,.tsv,.xlsx,.xls,.pdf,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
        <label className="block"><span className="label">…or paste text</span><textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste anything containing emails, business names, websites, phones" /></label>
        <button className="btn-primary" onClick={parse} disabled={busy}>{busy ? "Reading…" : "Read file / text"}</button>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>

      {table && (
        <div className="card space-y-4">
          <h2 className="h2">Map columns ({table.rows.length} rows)</h2>
          <div className="grid md:grid-cols-3 gap-3">
            {FIELDS.map(([f, label]) => (
              <label key={f}><span className="label">{label}</span>
                <select className="input" value={map[f] ?? ""} onChange={(e) => setMap({ ...map, [f]: e.target.value === "" ? undefined : Number(e.target.value) })}>
                  <option value="">— none —</option>
                  {table.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="overflow-x-auto"><table className="tbl"><thead><tr>{table.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.slice(0, 5).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="max-w-[200px] truncate">{c}</td>)}</tr>)}</tbody></table></div>
          <button className="btn-primary" onClick={preview} disabled={busy}>{busy ? "Checking (MX lookups)…" : "Check & preview"}</button>
        </div>
      )}

      {extracted && (
        <div className="card space-y-4">
          <h2 className="h2">Extracted {extracted.length} contacts (best effort)</h2>
          <div className="overflow-x-auto max-h-96"><table className="tbl"><thead><tr><th>Email</th><th>Business</th><th>Website</th><th>Phone</th></tr></thead>
            <tbody>{extracted.slice(0, 200).map((r, i) => <tr key={i}><td>{r.email}</td><td>{r.businessName}</td><td>{r.website}</td><td>{r.phone}</td></tr>)}</tbody></table></div>
          <button className="btn-primary" onClick={preview} disabled={busy || !extracted.length}>{busy ? "Checking (MX lookups)…" : "Check & preview"}</button>
        </div>
      )}
    </div>
  );
}
