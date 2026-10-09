import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { log } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { listId } = await req.json();
  const list = await prisma.leadList.findUnique({ where: { id: listId } });
  if (!list || list.confirmed) return NextResponse.json({ error: "List not found or already confirmed" }, { status: 400 });
  const rows = await prisma.importRow.findMany({ where: { listId, outcome: { in: ["send", "review"] } } });
  let created = 0;
  for (const r of rows) {
    try {
      // unique email + unique business key enforce "once ever" at DB level
      await prisma.lead.create({
        data: { email: r.email!, businessKey: r.businessKey!, businessName: r.businessName, website: r.website, phone: r.phone, country: r.country, listId, status: r.outcome === "review" ? "needs_review" : "ready" },
      });
      created++;
    } catch {
      await prisma.importRow.update({ where: { id: r.id }, data: { outcome: "skip", reason: "already contacted / imported (race)" } });
    }
  }
  await prisma.leadList.update({ where: { id: listId }, data: { confirmed: true } });
  await log("info", "import", `list "${list.name}" confirmed: ${created} leads`);
  return NextResponse.json({ created });
}
