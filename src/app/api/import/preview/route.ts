import { NextResponse } from "next/server";
import { C, db, nowIso } from "@/lib/fsdb";
import { processRows, type InRow } from "@/lib/importer";
import { getT } from "@/lib/i18n-server";

export const runtime = "nodejs";
export const maxDuration = 300;

/** optional facts for the AI: trimmed, one line, length-capped */
const clean = (v?: string, max = 120) => (v || "").replace(/\s+/g, " ").trim().slice(0, max) || null;
/** a mail body from the file: its line breaks are kept */
const text = (v?: string, max = 4000) => (v || "").replace(/\r/g, "").trim().slice(0, max) || null;

export async function POST(req: Request) {
  const { t } = await getT();
  const { listName, sourceNote, rows } = (await req.json()) as { listName: string; sourceNote: string; rows: InRow[] };
  if (!rows?.length) return NextResponse.json({ error: t("List mein koi row nahi hai", "The list has no rows") }, { status: 400 });
  if (!sourceNote?.trim()) return NextResponse.json({ error: t("Batao ye addresses kahan se mile (ye mail ke footer mein dikhta hai)", "Say where you found these addresses (it is shown in the mail footer)") }, { status: 400 });
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
        contactName: clean(r.contactName), city: clean(r.city), category: clean(r.category), about: clean(r.about, 600), note: clean(r.note, 400),
        reviews: clean(r.reviews, 20), rating: clean(r.rating, 10), observation: clean(r.observation, 400),
        customSubject: clean(r.subject, 150), customBody: text(r.body),
      });
    }
    await b.commit();
  }
  return NextResponse.json({ listId: list.id });
}
