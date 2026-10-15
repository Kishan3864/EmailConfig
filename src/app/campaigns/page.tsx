import Link from "next/link";
import type { ComponentProps } from "react";
import { C, count, rows, type Campaign, type LeadList } from "@/lib/fsdb";
import { getSettings } from "@/lib/settings";
import { countryInfo } from "@/lib/lang";
import { estimateFinish } from "@/lib/schedule";
import { fmtDate } from "@/lib/time";
import { Badge, EmptyState, NextStep, PageHeader, Progress, Section } from "@/components/ui";
import { CampaignForm } from "./CampaignForm";

export const metadata = { title: "Campaigns" };

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
    const review = leads.filter((x) => x.get("status") === "needs_review").length;
    return { id: l.id, name: l.name, count: leads.length, review, language: ci?.language || "en", timezone: ci?.timezone || "Europe/Paris" };
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

  const available = listInfo.filter((l) => l.count > 0);
  const newest = out.reverse(); // newest first
  const draft = newest.find((x) => x.c.status === "draft");
  const paused = newest.find((x) => x.c.status === "paused")?.c;
  const running = newest.some((x) => x.c.status === "running");
  // Settings "Har mail approve karke hi bhejo" is off: after the 5 samples, drafts approve themselves
  const auto = !s.approveEach;

  const runningNext: ComponentProps<typeof NextStep> = s.dryRun
    ? auto
      ? { text: "Campaign DRY-RUN mein chal raha hai: drafts apne aap approve hoke sirf aapke test address pe jaati hain, leads ko nahi. Test mails Sent page pe dekho; sab theek ho to Dashboard se LIVE karo.", href: "/#mode", cta: "Mode dekho" }
      : { text: "Campaign DRY-RUN mein chal raha hai: approve ki hui mails sirf aapke test address pe jaati hain, leads ko nahi. Nayi drafts Approve page pe approve karo; sab theek ho to Dashboard se LIVE karo.", href: "/review", cta: "Approve page kholo" }
    : auto
      ? { text: "Campaign chal raha hai. Auto-approve on hai: nayi drafts aapke padhe bina apne aap approve hoke leads ko jaati hain. Har mail pehle padhni ho to Settings mein ‘Har mail approve karke hi bhejo’ on karo.", href: "/settings", cta: "Settings dekho" }
      : { text: "Campaign chal raha hai. Nayi drafts Approve page pe aati hain: unhe padh ke approve karo, tabhi mail jayegi.", href: "/review", cta: "Approve page kholo" };

  // what to do next, depending on where the campaigns stand
  const nextIsImport = !draft && !running && !paused && !available.length;
  const next: ComponentProps<typeof NextStep> = draft
    ? draft.remaining
      ? { text: <><b className="font-semibold text-slate-900">{draft.c.name}</b> ke 5 sample drafts banao, unhe padho aur start karo.</>, href: `/campaigns/${draft.c.id}`, cta: "Campaign kholo" }
      : { text: <><b className="font-semibold text-slate-900">{draft.c.name}</b> mein abhi koi Ready lead nahi hai, isliye samples nahi ban sakte. Campaign kholo: wahan likha hai aage kya karna hai.</>, href: `/campaigns/${draft.c.id}`, cta: "Campaign kholo", tone: "amber" }
    : running
      ? runningNext
      : paused
        ? { text: <><b className="font-semibold text-slate-900">{paused.name}</b> ruka hua hai. Taiyaar ho to campaign kholo aur ‘Resume karo’ dabao.</>, href: `/campaigns/${paused.id}`, cta: "Campaign kholo", tone: "amber" }
        : nextIsImport
          ? { text: campaigns.length ? "Naya campaign banane ke liye nayi leads chahiye. Pehle leads ki list import karo." : "Shuru karne ke liye pehle leads ki list import karo. Uske baad yahan campaign banega.", href: "/import", cta: "Leads import karo" }
          : { text: "Neeche form mein list chuno aur ‘Campaign banao’ dabao. Uske baad 5 sample drafts banenge." };

  const form = (
    <Section
      id="naya-campaign"
      title="Naya campaign banao"
      icon="plus"
      info="List chuno, bhasha aur timezone check karo, phir ‘Campaign banao’ dabao. List ke saare free leads is campaign mein jud jaate hain. Banane se koi mail nahi jaati: pehle 5 samples banenge, jinhe aap padhoge."
      sub="Sirf wahi lists dikhti hain jinke leads abhi kisi campaign mein nahi hain."
    >
      <CampaignForm lists={available} />
    </Section>
  );

  const table = (
    <Section
      flush
      title="Saare campaigns"
      icon="megaphone"
      info="Har campaign ka haal: kitni mails gayi (Bheji), kitni baaki hain (Baaki) aur andaza kab tak sab chali jayengi. Date sirf chalte campaign ki dikhti hai. Detail aur controls ke liye campaign ke naam pe click karo."
      sub={newest.length ? `${newest.length} campaign · naye sabse upar` : undefined}
    >
      {newest.length ? (
        <div className="overflow-x-auto">
          <table className="tbl tbl-stack">
            <thead>
              <tr><th>Naam</th><th>Status</th><th>List</th><th>Bhasha / Timezone</th><th className="md:!text-right">Bheji</th><th className="md:!text-right">Baaki</th><th>Kab tak khatam</th></tr>
            </thead>
            <tbody>
              {newest.map(({ c, remaining, sent, finish }) => {
                const total = sent + remaining;
                const pct = c.status === "done" ? 1 : total ? sent / total : 0;
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="min-w-0">
                        <Link href={`/campaigns/${c.id}`} className="link break-words">{c.name}</Link>
                        <div className="mt-0.5 text-xs text-slate-400">Banaya: {fmtDate(c.createdAt)}</div>
                      </div>
                    </td>
                    <td data-label="Status"><Badge v={c.status} /></td>
                    <td data-label="List"><span className="break-words">{listNames.get(c.listId) || "—"}</span></td>
                    <td data-label="Bhasha / Timezone"><span className="whitespace-nowrap">{c.language.toUpperCase()} · {c.timezone}</span></td>
                    <td data-label="Bheji" className="tabular-nums md:text-right">{sent}</td>
                    <td data-label="Baaki" className="tabular-nums md:text-right">{remaining}</td>
                    <td data-label="Kab tak khatam">
                      <div className="min-w-0">
                        <div className="whitespace-nowrap">{c.status === "done" ? "Poora ho gaya" : c.status === "running" ? fmtDate(finish) : c.status === "paused" ? "Ruka hua" : "Start ke baad"}</div>
                        <div className="mt-1.5 flex items-center justify-end gap-2 md:justify-start" title={`${sent} bheji, ${remaining} baaki`}>
                          <div className="w-20"><Progress value={pct} tone={c.status === "done" ? "emerald" : "indigo"} /></div>
                          <span className="text-2xs tabular-nums text-slate-400">{Math.round(pct * 100)}%</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon="megaphone" title="Abhi koi campaign nahi" text={available.length ? "Upar wale form se pehla campaign banao." : "Leads import hone ke baad yahan pehla campaign banega."} />
      )}
    </Section>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Campaigns"
        info={auto
          ? "Campaign = ek lead list + bhasha + timezone. Flow: campaign banao → 5 sample drafts banao → unhe padh ke approve karke start karo → uske baad nayi drafts apne aap approve hoti hain (Settings mein auto-approve on hai) → worker sending window mein dheere-dheere bhejta hai."
          : "Campaign = ek lead list + bhasha + timezone. Flow: campaign banao → 5 sample drafts banao → unhe padh ke approve karke start karo → baaki har mail Approve page pe approve karo → worker sending window mein dheere-dheere bhejta hai."}
        sub={auto
          ? "Lead list se campaign banao. Pehle 5 samples aap approve karte ho; uske baad auto-approve on hai, mails apne aap jaati hain (Settings mein badal sakte ho)."
          : "Lead list se campaign banao. Aapke approve kiye bina koi mail nahi jaati."}
      />
      <NextStep {...next} />
      {/* a free list → the form comes first; otherwise the campaign list is what matters (and with nothing to import from, the NextStep above already points to Import) */}
      {available.length ? <>{form}{table}</> : <>{table}{!nextIsImport && form}</>}
    </div>
  );
}
