import { prisma } from "@/lib/db";

export const runtime = "nodejs";

function esc(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, `""`)}"` : s;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = u.searchParams.get("q") || "";
  const status = u.searchParams.get("status") || "";
  const leads = await prisma.lead.findMany({
    where: { ...(status ? { status } : {}), ...(q ? { OR: [{ email: { contains: q } }, { businessName: { contains: q } }] } : {}) },
    include: { message: true, campaign: true, list: true },
    orderBy: { id: "asc" },
  });
  const head = ["email", "business", "website", "phone", "country", "status", "list", "campaign", "subject", "sent_at", "smtp_response"];
  const lines = [
    head.join(","),
    ...leads.map((l) => [l.email, l.businessName, l.website, l.phone, l.country, l.status, l.list.name, l.campaign?.name, l.message?.subject, l.message?.sentAt?.toISOString(), l.message?.smtpResponse].map(esc).join(",")),
  ];
  return new Response("﻿" + lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
