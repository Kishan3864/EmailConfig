import { NextResponse } from "next/server";
import { C, db, nowIso } from "@/lib/fsdb";
import { processRows, type InRow } from "@/lib/importer";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const { listName, sourceNote, rows } = (await req.json()) as { listName: string; sourceNote: string; rows: InRow[] };
  if (!rows?.length) return NextResponse.json({ error: "No rows" }, { status: 400 });
  if (!sourceNote?.trim()) return NextResponse.json({ error: "Say where you found these addresses (shown in the footer)" }, { status: 400 });
  const out = await processRows(rows);
  const counts = { send: 0, review: 0, skip: 0 } as Record<string, number>;
  for (const r of out) counts[r.outcome]++;
  const list = await C.lists.add({ name: listName || `List ${nowIso().slice(0, 10)}`, sourceNote: sourceNote.trim(), confirmed: false, createdAt: nowIso(), counts });
  for (let i = 0; i < out.length; i += 400) {
    const b = db.batch();
    for (const r of out.slice(i, i + 400)) {
      b.set(list.collection("rows").doc(String(r.rowNo).padStart(6, "0")), {
        rowNo: r.rowNo, email: r.email || null, businessName: r.businessName || null, website: r.website || null, phone: r.phone || null,
        country: r.country || null, outcome: r.outcome, reason: r.reason || null, businessKey: r.businessKey || null,
      });
    }
    await b.commit();
  }
  return NextResponse.json({ listId: list.id });
}
