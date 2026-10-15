"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Info } from "@/components/Info";
import { friendlyError, useToast } from "@/components/toast";
import { Callout, EmptyState, Field, NextStep, PageHeader, Section, Steps, type StepState } from "@/components/ui";

type Row = { email?: string; businessName?: string; website?: string; phone?: string; country?: string; chain?: string };
const FIELDS: [keyof Row, string][] = [["email", "Email *"], ["businessName", "Business ka naam"], ["website", "Website"], ["phone", "Phone"], ["country", "Desh"], ["chain", "Chain hai?"]];

const GUESS: Record<keyof Row, RegExp> = {
  email: /e-?mail|courriel|mail/i, businessName: /business|company|name|nom|soci[ée]t[ée]|entreprise|title/i, website: /web|site|url|domain/i,
  phone: /phone|t[ée]l|mobile/i, country: /country|pays|land/i, chain: /chain|cha[iî]ne|franchise/i,
};

const FIELD_INFO: Record<keyof Row, string> = {
  email: "Wo column jismein email address hain. Ye zaroori hai. Ek cell mein kai emails hon to app khud sabse achha chunta hai (contact@, info@ pehle; jobs@, privacy@ jaise role address nahi).",
  businessName: "Business ka naam. AI mail likhte waqt isko use karta hai. Column na ho to '— koi nahi —' rehne do.",
  website: "Business ki website. Iske domain se pata chalta hai ki ek business ko ek hi mail jaye. Block list bhi isi se check hoti hai.",
  phone: "Sirf record ke liye save hota hai. Mail mein use nahi hota.",
  country: "Lead ka desh (jaise France ya FR). Isse campaign ki bhasha aur time zone ka suggestion milta hai, aur AI mail likhte waqt isko dhyan mein rakhta hai.",
  chain: "Agar koi column batata hai ki business chain ya franchise hai (1, yes, oui, x), to wo rows skip hongi. Chain businesses ko cold mail nahi bhejte.",
};

const KNOWN_TYPES = /\.(csv|tsv|xlsx|xls|pdf|txt)$/i;
const fileSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const PHONE_ROWS = 20; // phones list only this many extracted contacts (no scroll box inside the page); all of them still go to the check

type ParseRes = { error?: string; kind?: "table" | "extracted"; headers?: string[]; rows?: unknown[] };
type Problem = { at: "parse" | "preview"; title: string; text?: string };

export default function ImportPage() {
  const router = useRouter();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [listName, setListName] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [table, setTable] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [extracted, setExtracted] = useState<Row[] | null>(null);
  const [map, setMap] = useState<Partial<Record<keyof Row, number>>>({});
  const [busy, setBusy] = useState<"" | "parse" | "preview">("");
  const [err, setErr] = useState<Problem | null>(null);
  const [drag, setDrag] = useState(false);
  const [reads, setReads] = useState(0); // bumps after every successful read, to bring step 2 into view
  const sourceRef = useRef<HTMLInputElement>(null);
  const autoName = useRef(false); // listName came from the file name (not typed), so a new file may replace it
  const readNo = useRef(0); // bumps on every read and every input change, so a read that finishes late is ignored

  useEffect(() => { document.title = "Leads import · Outreach"; }, []);
  useEffect(() => { if (reads) document.getElementById("step2")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [reads]);

  const fail = (at: Problem["at"], title: string, text?: string) => { setErr({ at, title, text }); toast.error(title, text); };

  // A new file or changed text makes the last read stale: step 2 goes away until 'File / text padho' is pressed again,
  // so a preview can never be built from the previous file's rows.
  function resetRead() {
    readNo.current++;
    setTable(null); setExtracted(null); setMap({}); setErr(null);
  }
  function pick(f: File | null) {
    setFile(f);
    resetRead();
    if (autoName.current) { setListName(""); autoName.current = false; } // the old file's name; the next read fills in the new one
    if (f && !KNOWN_TYPES.test(f.name)) toast.warning("Ye file type seedha support nahi hai", "App ise text ki tarah padh ke emails dhoondhega. Behtar result ke liye CSV ya XLSX do.");
  }
  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pick(f);
  }

  async function parse() {
    if (!file && !text.trim()) return fail("parse", "Pehle file chuno ya text paste karo", "CSV, XLSX, PDF ya TXT file do, ya neeche text paste karo.");
    const no = ++readNo.current;
    setErr(null); setBusy("parse");
    const fd = new FormData();
    if (file) fd.append("file", file);
    fd.append("text", text);
    try {
      const r = await fetch("/api/import/parse", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as ParseRes;
      if (no !== readNo.current) return; // the file or text changed while this was being read
      // the route says "File padh nahi paye: <reason>"; the title already says that, so show only the reason
      if (!r.ok || !j.kind) return fail("parse", "File padh nahi paye", j.error?.replace(/^File padh nahi paye:\s*/i, "") || `Server ne error diya (${r.status})`);
      if (!listName && file) { setListName(file.name.replace(/\.\w+$/, "")); autoName.current = true; }
      if (j.kind === "table") {
        const headers = j.headers ?? [], rows = (j.rows ?? []) as string[][];
        setTable({ headers, rows }); setExtracted(null);
        const m: Partial<Record<keyof Row, number>> = {};
        for (const [f] of FIELDS) { const i = headers.findIndex((h) => GUESS[f].test(h)); if (i >= 0 && !Object.values(m).includes(i)) m[f] = i; }
        setMap(m);
        if (!rows.length) toast.warning("File mein koi data row nahi mili", "Pehli line column ke naam maani jaati hai; uske neeche rows honi chahiye.");
        else toast.success(`${plural(rows.length, "row", "rows")} mil gayi`, m.email === undefined ? "Email wala column khud nahi mila. Neeche 'Email *' mein chuno." : "Neeche columns check karo, phir preview dekho.");
      } else {
        const rows = (j.rows ?? []) as Row[];
        setExtracted(rows); setTable(null);
        if (rows.length) toast.success(`${plural(rows.length, "contact", "contacts")} ${rows.length === 1 ? "mila" : "mile"}`, "Neeche list check karo, phir preview dekho.");
        else toast.warning("Koi email nahi mila", "Is file ya text mein koi email address nahi dikha.");
      }
      setReads((n) => n + 1);
    } catch (e) {
      if (no === readNo.current) fail("parse", "Server se jawab nahi aaya", friendlyError(e));
    } finally {
      setBusy("");
    }
  }

  async function preview() {
    let rows: Row[] = extracted || [];
    if (table) {
      if (map.email === undefined) return fail("preview", "Email wala column chuno", "'Email *' ke saamne wo column chuno jismein email address hain.");
      rows = table.rows.map((r) => Object.fromEntries(FIELDS.filter(([f]) => map[f] !== undefined).map(([f]) => [f, r[map[f]!] ?? ""])) as Row);
    }
    if (!sourceNote.trim()) {
      sourceRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      sourceRef.current?.focus({ preventScroll: true });
      return fail("preview", "Batao ye addresses kahan se mile", "Ye mail ke footer mein dikhta hai. Upar 'List ki jaankari' mein bharo.");
    }
    if (!rows.length) return fail("preview", "Check karne ke liye koi row nahi hai", "Aisi file ya text do jismein email address hon.");
    setErr(null); setBusy("preview");
    try {
      const r = await fetch("/api/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listName, sourceNote, rows }) });
      const j = (await r.json().catch(() => ({}))) as { listId?: string; error?: string };
      if (!r.ok || !j.listId) { setBusy(""); return fail("preview", "Preview nahi ban paya", j.error || `Server ne error diya (${r.status})`); }
      toast.success("Preview taiyaar hai", "Har row ka result dekho, phir import confirm karo.");
      router.push(`/import/${j.listId}`); // stays busy until the preview page opens, so a second click cannot create a second list
    } catch (e) {
      setBusy("");
      fail("preview", "Server se jawab nahi aaya", friendlyError(e));
    }
  }

  const parsed = !!table || !!extracted;
  const ready = (table?.rows.length || extracted?.length || 0) > 0; // something was read that can be checked
  // short labels on phones so all three steps fit on one line
  const steps = (short: boolean): { label: string; state: StepState }[] => [
    { label: short ? "File do" : "File ya text do", state: ready ? "done" : "current" },
    { label: extracted ? (short ? "Check karo" : "Contacts check karo") : short ? "Match karo" : "Columns match karo", state: ready ? "current" : "todo" },
    { label: short ? "Confirm" : "Preview & confirm", state: "todo" },
  ];
  const needSource = err?.at === "preview" && !sourceNote.trim();
  const needEmail = err?.at === "preview" && map.email === undefined;
  const mappedTo = (i: number) => FIELDS.find(([f]) => map[f] === i)?.[1].replace(" *", "");

  const previewBar = (note: string) => (
    <>
      {err?.at === "preview" && <div className="mt-4"><Callout tone="danger" title={err.title}>{err.text}</Callout></div>}
      <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-1.5 text-xs text-slate-500"><Icon name="shield" size={14} className="mt-px text-slate-400" />{note}</p>
        <button type="button" className="btn-primary h-10 w-full sm:h-8 sm:w-auto" onClick={preview} disabled={!!busy}>
          <Icon name={busy === "preview" ? "loader" : "eye"} size={14} className={busy === "preview" ? "animate-spin" : ""} />
          {busy === "preview" ? "Check ho raha hai (MX lookup)…" : "Check karke preview dekho"}
        </button>
      </div>
    </>
  );

  return (
    <div>
      <PageHeader
        title="Leads import karo"
        info={"Yahan se leads ki list app mein lao: CSV, XLSX, PDF, TXT file ya seedha paste kiya text.\nHar address check hota hai: MX record, role address (jaise jobs@, privacy@), chain, Ledger aur Block list.\nKuch bhi turant add nahi hota. Pehle preview dikhta hai; aap confirm karoge tabhi leads Contacts mein jayenge."}
        sub="File do, columns match karo, phir preview dekh ke confirm karo."
      />

      <div className="space-y-4">
        <div>
          <div className="sm:hidden"><Steps steps={steps(true)} /></div>
          <div className="hidden sm:block"><Steps steps={steps(false)} /></div>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
            <Icon name="shield" size={14} className="mt-px shrink-0 text-slate-400" />
            <span>Pehli baar import kar rahe ho? Pehle <Link href="/ledger" className="font-medium text-indigo-600 hover:text-indigo-700">Contacted Ledger</Link> mein purane contacts daalo (Sent folder import), taaki unhe dobara mail na jaye.</span>
          </p>
        </div>

        <Section title="List ki jaankari" icon="file" info="List ka naam sirf aapki pehchaan ke liye hai. 'Kahan se mile' zaroori hai, kyunki ye har mail ke footer mein sach-sach likha jata hai.">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="List ka naam" info="Baad mein list pehchaanne ke liye, jaise 'Paris restaurants Oct'. Khaali chhodo to file ka naam (ya aaj ki date) use hoga." hint="Khaali chhodo to file ka naam use hoga.">
              <input className="input" value={listName} onChange={(e) => { setListName(e.target.value); autoName.current = false; }} placeholder="Jaise Paris restaurants Oct" />
            </Field>
            <Field label="Ye addresses kahan se mile? *" info={"Ye har mail ke footer mein likha jata hai, jaise: 'I found your address on Google Maps.' (mail ki bhasha mein).\nSach aur chhota likho: 'Google Maps', 'aapki website', 'PagesJaunes'."}
              hint={needSource ? <span className="text-red-600">Ye bharna zaroori hai: mail ke footer mein dikhta hai.</span> : "Mail ke footer mein dikhega."}>
              <input ref={sourceRef} className={`input ${needSource ? "border-red-400 focus:border-red-500 focus:ring-red-500/10" : ""}`} value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} placeholder="Jaise Google Maps" />
            </Field>
          </div>
        </Section>

        <Section title="File upload karo ya text paste karo" icon="upload"
          info={"CSV ya XLSX mein pehli line column ke naam honi chahiye; agle step mein unhe match karoge.\nPDF, TXT ya paste kiye text se app khud emails, naam, website aur phone dhoondhta hai (andaze se).\nFile aur text dono do to sirf file padhi jayegi."}>
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false); }}
            onDrop={onDrop}
            className={`group flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed px-4 text-center transition focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-500/10 ${file ? "gap-2.5 py-3.5" : "flex-col py-8 sm:py-10"} ${drag ? "border-indigo-400 bg-indigo-50/70" : "border-slate-200 bg-slate-50/60 hover:border-indigo-300 hover:bg-indigo-50/30"}`}>
            <input type="file" accept=".csv,.tsv,.xlsx,.xls,.pdf,.txt" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
            <span className={`grid place-items-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 transition group-hover:text-indigo-600 ${file ? "h-8 w-8" : "h-11 w-11"} ${drag ? "text-indigo-600" : "text-slate-500"}`}>
              <Icon name="upload" size={file ? 15 : 19} />
            </span>
            {file ? (
              <span className="text-sm font-medium text-slate-700">
                <span className="text-indigo-600 sm:hidden">Tap karke file badlo</span>
                <span className="hidden sm:inline">{drag ? "Yahan chhod do" : <>Doosri file yahan chhodo ya <span className="text-indigo-600">click karke badlo</span></>}</span>
              </span>
            ) : (
              <>
                <span className="mt-3 text-sm font-medium text-slate-800">
                  <span className="text-indigo-600 sm:hidden">Tap karke file chuno</span>
                  <span className="hidden sm:inline">{drag ? "Yahan chhod do" : <>File yahan chhodo ya <span className="text-indigo-600">click karke chuno</span></>}</span>
                </span>
                <span className="mt-1 text-xs text-slate-400">CSV, TSV, XLSX, XLS, PDF ya TXT</span>
              </>
            )}
          </label>

          {file && (
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5 pl-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-indigo-50 text-indigo-600"><Icon name="file" size={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">{file.name}</div>
                <div className="text-xs text-slate-500">{fileSize(file.size)} · padhne ke liye taiyaar</div>
              </div>
              <button type="button" onClick={() => pick(null)} className="btn-ghost btn-icon btn-sm" aria-label="File hatao" title="File hatao"><Icon name="x" size={14} /></button>
            </div>
          )}

          <div className="my-4 flex items-center gap-3 text-xs font-medium text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />ya text paste karo<span className="h-px flex-1 bg-slate-200" />
          </div>
          <textarea className="input" rows={5} value={text} onChange={(e) => { setText(e.target.value); if (!file) resetRead(); }} aria-label="Text paste karo"
            placeholder="Kuch bhi paste karo jismein emails, business ke naam, website ya phone hon" />
          {file && text.trim() && <p className="hint">File chuni hui hai, isliye ye text use nahi hoga. Text chahiye to upar se file hata do.</p>}

          {err?.at === "parse" && <div className="mt-4"><Callout tone="danger" title={err.title}>{err.text}</Callout></div>}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="button" className="btn-primary h-10 w-full sm:h-8 sm:w-auto" onClick={parse} disabled={!!busy}>
              <Icon name={busy === "parse" ? "loader" : "file-up"} size={14} className={busy === "parse" ? "animate-spin" : ""} />
              {busy === "parse" ? "Padh raha hai…" : "File / text padho"}
            </button>
            <span className="text-center text-xs text-slate-400 sm:text-left">Abhi kuch save nahi hota, sirf padha jata hai.</span>
          </div>
        </Section>

        {table && (
          <Section id="step2" className="scroll-mt-20" icon="sliders" title={`Columns match karo (${plural(table.rows.length, "row", "rows")})`}
            info={"Batao file ka kaunsa column kya hai. App ne column ke naam dekh ke khud andaza lagaya hai; galat ho to badal do.\nSirf Email zaroori hai. Baaki column na hon to '— koi nahi —' rehne do."}
            sub="Har field ke saamne file ka sahi column chuno.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map(([f, label]) => (
                <Field key={f} label={label} info={FIELD_INFO[f]} hint={f === "email" && map.email === undefined ? <span className="text-red-600">Ye zaroori hai</span> : undefined}>
                  <select className={`input ${f === "email" && needEmail ? "border-red-400" : ""}`} value={map[f] ?? ""} onChange={(e) => setMap({ ...map, [f]: e.target.value === "" ? undefined : Number(e.target.value) })}>
                    <option value="">— koi nahi —</option>
                    {table.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </Field>
              ))}
            </div>

            <div className="mb-2 mt-6 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              Pehli 5 rows ka preview
              <Info title="Pehli 5 rows" text="File ki shuruaat ki 5 rows, taaki column pehchaanna aasaan ho. Jo column kisi field se juda hai, uska header neela dikhta hai." size={13} />
            </div>
            {table.rows.length ? (
              <div className="card-flush !shadow-none">
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        {table.headers.map((h, i) => {
                          const to = mappedTo(i);
                          return (
                            <th key={i} className={to ? "!bg-indigo-50 !text-indigo-700" : ""}>
                              {h || `Column ${i + 1}`}
                              {to && <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-indigo-600 px-1 py-px normal-case tracking-normal text-white"><Icon name="arrow-right" size={10} strokeWidth={2.4} />{to}</span>}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.slice(0, 5).map((r, i) => (
                        <tr key={i}>{r.map((c, j) => <td key={j} className={mappedTo(j) ? "bg-indigo-50/30" : ""}><span className="block max-w-[200px] truncate" title={c}>{c}</span></td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <Callout tone="warn" title="File mein koi data row nahi mili">Pehli line column ke naam maani jaati hai; uske neeche rows honi chahiye. Doosri file try karo.</Callout>
            )}
            {table.rows.length > 0 && previewBar("Har address ka MX record, Ledger aur Block list check hoga. Badi file mein 1-2 minute lag sakte hain.")}
          </Section>
        )}

        {extracted && (
          <Section id="step2" className="scroll-mt-20" icon="list" title={extracted.length ? `${plural(extracted.length, "contact", "contacts")} ${extracted.length === 1 ? "mila" : "mile"} (andaze se)` : "Koi contact nahi mila"}
            info="PDF, TXT ya text se app ne emails dhoondhe, aur unke aas-paas se naam, website aur phone andaze se uthaya. Galti ho sakti hai; agle page pe har row ka result dikhega."
            sub={!extracted.length ? undefined : extracted.length > 200 ? "Yahan pehle 200 dikh rahe hain; check mein saare jayenge." : "Text se nikale gaye contacts. Ek nazar daal lo."}>
            {extracted.length ? (
              <div className="card-flush !shadow-none">
                {/* scroll box only on wider screens; on phones the cards follow the page scroll */}
                <div className="md:max-h-96 md:overflow-auto">
                  <table className="tbl tbl-stack">
                    <thead className="sticky top-0 z-[1] bg-slate-50"><tr><th>Email</th><th>Business</th><th>Website</th><th>Phone</th></tr></thead>
                    <tbody>
                      {extracted.slice(0, 200).map((r, i) => (
                        <tr key={i} className={i >= PHONE_ROWS ? "max-md:!hidden" : undefined}>
                          <td className="font-medium text-slate-900 max-md:[overflow-wrap:anywhere]">{r.email}</td>
                          <td data-label="Business">{r.businessName}</td>
                          <td data-label="Website">{r.website && <span className="block min-w-0 max-w-[220px] truncate" title={r.website}>{r.website}</span>}</td>
                          <td data-label="Phone" className="whitespace-nowrap">{r.phone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {extracted.length > PHONE_ROWS && (
                  <p className="px-4 py-2.5 text-xs text-slate-500 md:hidden">Yahan pehle {PHONE_ROWS} dikh rahe hain; check mein saare {extracted.length} jayenge.</p>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200">
                <EmptyState icon="search" title="Koi email nahi mila" text="Is file ya text mein koi email address nahi dikha. Doosri file chuno ya aisa text paste karo jismein emails hon." />
              </div>
            )}
            {extracted.length > 0 && previewBar("Har address ka MX record, Ledger aur Block list check hoga. Abhi kuch add nahi hoga.")}
          </Section>
        )}

        {!parsed ? (
          err?.at === "parse" && (file || text.trim()) ? (
            <NextStep tone="amber" text={<>Upar wali problem dekho, phir <b>File / text padho</b> dobara dabao. Na chale to doosri file do (CSV sabse aasaan hai).</>} />
          ) : (
            <NextStep text={!file && !text.trim()
              ? <>{sourceNote.trim() ? "File chuno ya text paste karo" : <>Upar <b>Kahan se mile</b> bharo, file chuno ya text paste karo</>}, phir <b>File / text padho</b> dabao.</>
              : <>Ab <b>File / text padho</b> dabao.{sourceNote.trim() ? " Uske baad check karke preview dekho." : <> Upar <b>Kahan se mile</b> bhi bhar do, preview ke liye ye zaroori hai.</>}</>} />
          )
        ) : !ready ? (
          <NextStep tone="amber" text={<>Is file ya text mein kaam ki koi row nahi mili. Doosri file chuno ya text paste karo, phir <b>File / text padho</b> dabao.</>} />
        ) : (
          <NextStep text={<>{table ? "Columns sahi lag rahe hain" : "List theek lag rahi hai"}? <b>Check karke preview dekho</b> dabao. Agle page pe har address ka result dikhega, aur wahin se import confirm hoga.</>} />
        )}
      </div>
    </div>
  );
}
