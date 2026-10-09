import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { processRows, type InRow } from "@/lib/importer";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const { listName, sourceNote, rows } = (await req.json()) as { listName: string; sourceNote: string; rows: InRow[] };
  if (!rows?.length) return NextResponse.json({ error: "No rows" }, { status: 400 });
  if (!sourceNote?.trim()) return NextResponse.json({ error: "Say where you found these addresses (shown in the footer)" }, { status: 400 });
  const out = await processRows(rows);
  const list = await prisma.leadList.create({ data: { name: listName || `List ${new Date().toISOString().slice(0, 10)}`, sourceNote: sourceNote.trim() } });
  await prisma.importRow.createMany({
    data: out.map((r) => ({ listId: list.id, rowNo: r.rowNo, email: r.email || null, businessName: r.businessName || null, website: r.website || null, phone: r.phone || null, country: r.country || null, outcome: r.outcome, reason: r.reason || null, businessKey: r.businessKey || null })),
  });
  return NextResponse.json({ listId: list.id });
}
