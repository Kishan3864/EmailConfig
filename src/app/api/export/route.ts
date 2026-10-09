import { C, rows, type Lead, type Message, type Campaign, type LeadList } from "@/lib/fsdb";

export const runtime = "nodejs";

function esc(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, `""`)}"` : s;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") || "").toLowerCase();
  const status = u.searchParams.get("status") || "";
  let leads = rows<Lead>(await (status ? C.leads.where("status", "==", status) : C.leads).get());
  if (q) leads = leads.filter((l) => `${l.email} ${l.businessName || ""} ${l.website || ""}`.toLowerCase().includes(q));
  const msgs = new Map(rows<Message>(await C.messages.get()).map((m) => [m.id, m]));
  const camps = new Map(rows<Campaign>(await C.campaigns.get()).map((c) => [c.id, c.name]));
  const lists = new Map(rows<LeadList>(await C.lists.get()).map((l) => [l.id, l.name]));
  const head = ["email", "business", "website", "phone", "country", "status", "list", "campaign", "subject", "sent_at", "smtp_response"];
  const lines = [
    head.join(","),
    ...leads.map((l) => {
      const m = msgs.get(l.id);
      return [l.email, l.businessName, l.website, l.phone, l.country, l.status, lists.get(l.listId), l.campaignId ? camps.get(l.campaignId) : "", m?.subject, m?.sentAt, m?.smtpResponse].map(esc).join(",");
    }),
  ];
  return new Response("﻿" + lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
