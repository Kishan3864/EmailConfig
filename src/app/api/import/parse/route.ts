import { NextResponse } from "next/server";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { extractFromText } from "@/lib/extract";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const fd = await req.formData();
  const file = fd.get("file") as File | null;
  const pasted = String(fd.get("text") || "");
  try {
    if (!file || file.size === 0) {
      if (!pasted.trim()) return NextResponse.json({ error: "No file or text" }, { status: 400 });
      return NextResponse.json({ kind: "extracted", rows: extractFromText(pasted) });
    }
    const name = file.name.toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());
    if (name.endsWith(".csv") || name.endsWith(".tsv")) {
      const parsed = Papa.parse<string[]>(buf.toString("utf8").replace(/^﻿/, ""), { skipEmptyLines: true });
      const [headers, ...rows] = parsed.data;
      return NextResponse.json({ kind: "table", headers, rows });
    }
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const wb = XLSX.read(buf, { type: "buffer" });
      const data = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
      const [headers, ...rows] = data.filter((r) => r.some((c) => String(c).trim()));
      return NextResponse.json({ kind: "table", headers: headers.map(String), rows: rows.map((r) => r.map(String)) });
    }
    if (name.endsWith(".pdf")) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdf = require("pdf-parse/lib/pdf-parse.js");
      const out = await pdf(buf);
      return NextResponse.json({ kind: "extracted", rows: extractFromText(out.text) });
    }
    return NextResponse.json({ kind: "extracted", rows: extractFromText(buf.toString("utf8")) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "parse failed" }, { status: 400 });
  }
}
