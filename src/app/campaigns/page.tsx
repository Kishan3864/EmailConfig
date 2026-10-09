import Link from "next/link";
import { C, count, rows, type Campaign, type LeadList } from "@/lib/fsdb";
import { getSettings } from "@/lib/settings";
import { countryInfo } from "@/lib/lang";
import { estimateFinish } from "@/lib/schedule";
import { fmtDate } from "@/lib/time";
import { Badge } from "@/components/ui";
import { CampaignForm } from "./CampaignForm";

export default async function Campaigns() {
  const s = await getSettings();
  const campaigns = rows<Campaign>(await C.campaigns.get()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lists = rows<LeadList>(await C.lists.where("confirmed", "==", true).get());
  const listNames = new Map(lists.map((l) => [l.id, l.name]));
  const listInfo = await Promise.all(lists.map(async (l) => {
    const leads = (await C.leads.where("listId", "==", l.id).get()).docs.filter((d) => !d.get("campaignId") && ["ready", "needs_review"].includes(d.get("status")));
    const freq = new Map<string, number>();
    for (const x of leads) if (x.get("country")) freq.set(x.get("country"), (freq.get(x.get("country")) || 0) + 1);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const ci = countryInfo(top);
    return { id: l.id, name: l.name, count: leads.length, language: ci?.language || "en", timezone: ci?.timezone || "Europe/Paris" };
  }));

  let ahead = 0;
  const out = [];
  for (const c of campaigns) {
    const remaining = await count(C.leads.where("campaignId", "==", c.id).where("status", "==", "ready"));
    const sent = await count(C.leads.where("campaignId", "==", c.id).where("status", "in", ["sent", "replied", "bounced", "opted_out"]));
    const finish = c.status === "done" ? null : await estimateFinish(s, c.timezone, remaining, ahead);
    if (c.status === "running") ahead += remaining;
    out.push({ c, remaining, sent, finish });
  }

  return (
    <div className="space-y-6">
      <h1 className="h1">Campaigns</h1>
      <CampaignForm lists={listInfo.filter((l) => l.count > 0)} />
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Status</th><th>List</th><th>Lang / TZ</th><th>Sent</th><th>Remaining</th><th>Est. finish</th></tr></thead>
          <tbody>
            {out.reverse().map(({ c, remaining, sent, finish }) => (
              <tr key={c.id}>
                <td><Link href={`/campaigns/${c.id}`} className="text-indigo-600 font-medium">{c.name}</Link></td>
                <td><Badge v={c.status} /></td><td>{listNames.get(c.listId)}</td><td>{c.language} · {c.timezone}</td>
                <td>{sent}</td><td>{remaining}</td><td>{c.status === "done" ? "finished" : fmtDate(finish)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
