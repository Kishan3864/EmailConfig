import { NextResponse } from "next/server";
import { C, db, key, nowIso, rows as toRows, type ImportRow } from "@/lib/fsdb";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const { listId } = await req.json();
  const listRef = C.lists.doc(String(listId));
  const list = await listRef.get();
  if (!list.exists || list.get("confirmed")) return NextResponse.json({ error: "List not found or already confirmed" }, { status: 400 });
  const rows = toRows<ImportRow>(await listRef.collection("rows").where("outcome", "in", ["send", "review"]).get());

  let created = 0;
  const one = async (r: ImportRow) => {
    const id = key(r.email!);
    try {
      // final re-check of the permanent ledger, then create-only writes:
      // a lead (per address) and a business claim can never exist twice
      const [ce, cb] = await db.getAll(C.contacted.doc(id), C.contactedBiz.doc(key(r.businessKey!)));
      if (ce.exists || cb.exists) throw new Error("already contacted (in Firebase ledger)");
      const b = db.batch();
      b.create(C.leads.doc(id), {
        email: r.email, businessKey: r.businessKey, businessName: r.businessName, website: r.website, phone: r.phone, country: r.country,
        listId: listRef.id, campaignId: null, status: r.outcome === "review" ? "needs_review" : "ready", hasMessage: false, createdAt: nowIso(), updatedAt: nowIso(),
      });
      b.create(C.businesses.doc(key(r.businessKey!)), { leadId: id, at: nowIso() });
      await b.commit();
      created++;
    } catch (e) {
      const why = e instanceof Error && /ALREADY_EXISTS/.test(e.message) ? "already imported (race)" : e instanceof Error ? e.message : "failed";
      await listRef.collection("rows").doc(r.id).update({ outcome: "skip", reason: why });
    }
  };
  for (let i = 0; i < rows.length; i += 20) await Promise.all(rows.slice(i, i + 20).map(one));

  const all = toRows<ImportRow>(await listRef.collection("rows").get());
  const counts = { send: 0, review: 0, skip: 0 } as Record<string, number>;
  for (const r of all) counts[r.outcome]++;
  await listRef.update({ confirmed: true, counts });
  await log("info", "import", `list "${list.get("name")}" confirmed: ${created} leads`);
  return NextResponse.json({ created });
}
