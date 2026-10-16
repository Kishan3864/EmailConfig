import Link from "next/link";
import type { ComponentProps } from "react";
import { C, count, rows, type Campaign, type LeadList } from "@/lib/fsdb";
import { getSettings } from "@/lib/settings";
import { getT } from "@/lib/i18n-server";
import { countryInfo } from "@/lib/lang";
import { estimateFinish } from "@/lib/schedule";
import { TEMPLATE_IDS, mailPlan, templateLabel, templateOf } from "@/lib/templates";
import { hasOwnWebsite } from "@/lib/website";
import { fmtDate } from "@/lib/time";
import { Badge, EmptyState, NextStep, PageHeader, Progress, Section } from "@/components/ui";
import { Icon } from "@/components/icons";
import { tryTemplate } from "../settings/template-check";
import { CampaignForm, type TemplateChoice } from "./CampaignForm";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Campaigns", "Campaigns") };
}

export default async function Campaigns() {
  const { t } = await getT();
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
    // for a "by website" campaign: how many of the free leads get which template
    const site = leads.filter((x) => hasOwnWebsite(x.get("website"))).length;
    return { id: l.id, name: l.name, count: leads.length, review, noSite: leads.length - site, site, language: ci?.language || "en", timezone: ci?.timezone || "Europe/Paris" };
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
  // the six Settings templates for the form: whom each is written for, the language its text is in and whether it passes
  // the draft rules (a template for leads with a website is filled with an example lead that has one, for {{website}})
  const templates: TemplateChoice[] = TEMPLATE_IDS.map((id) => {
    const x = templateOf(s, id);
    const r = tryTemplate(x.subject, x.body, s, true, x.for === "site");
    return { id, name: x.name, lang: r.lang, ok: r.ok, for: x.for };
  });
  // "AI", "Template 2: More enquiries" or "Website ke hisaab se: T3 + T6" (a campaign without a mailType is an AI campaign);
  // detail = which template goes to which group, for the tooltip
  const mailTypeOf = (c: Campaign): { label: string; detail?: string; ai: boolean } => {
    const p = mailPlan(c);
    if (p.kind === "ai") return { label: "AI", ai: true };
    if (p.kind === "one" || p.nosite === p.site) return { label: templateLabel(s, p.kind === "one" ? p.id : p.site), ai: false };
    const pair = `T${p.nosite.slice(3)} + T${p.site.slice(3)}`;
    return {
      label: t(`Website ke hisaab se: ${pair}`, `By website: ${pair}`),
      detail: t(
        `Jinki website NAHI hai: ${templateLabel(s, p.nosite)}\nJinki website HAI: ${templateLabel(s, p.site)}`,
        `Leads without a website: ${templateLabel(s, p.nosite)}\nLeads with a website: ${templateLabel(s, p.site)}`,
      ),
      ai: false,
    };
  };
  const newest = out.reverse(); // newest first
  const draft = newest.find((x) => x.c.status === "draft");
  const paused = newest.find((x) => x.c.status === "paused")?.c;
  const running = newest.some((x) => x.c.status === "running");
  // Settings "Har mail approve karke hi bhejo" is off: after the 5 samples, drafts approve themselves
  const auto = !s.approveEach;

  const runningNext: ComponentProps<typeof NextStep> = s.dryRun
    ? auto
      ? {
        text: t(
          "Campaign DRY-RUN mein chal raha hai: drafts apne aap approve hoke sirf aapke test address pe jaati hain, leads ko nahi. Test mails Sent page pe dekho; sab theek ho to Dashboard se LIVE karo.",
          "The campaign is running in DRY-RUN: drafts are approved automatically and go only to your test address, not to the leads. Check the test mails on the Sent page; if all looks good, switch to LIVE on the Dashboard.",
        ),
        href: "/#mode", cta: t("Mode dekho", "See mode"),
      }
      : {
        text: t(
          "Campaign DRY-RUN mein chal raha hai: approve ki hui mails sirf aapke test address pe jaati hain, leads ko nahi. Nayi drafts Approve page pe approve karo; sab theek ho to Dashboard se LIVE karo.",
          "The campaign is running in DRY-RUN: approved mails go only to your test address, not to the leads. Approve new drafts on the Approve page; if all looks good, switch to LIVE on the Dashboard.",
        ),
        href: "/review", cta: t("Approve page kholo", "Open Approve page"),
      }
    : auto
      ? {
        text: t(
          "Campaign chal raha hai. Auto-approve on hai: nayi drafts aapke padhe bina apne aap approve hoke leads ko jaati hain. Har mail pehle padhni ho to Settings mein ‘Har mail approve karke hi bhejo’ on karo.",
          "The campaign is running. Auto-approve is on: new drafts are approved automatically and go to the leads without you reading them. To read every mail first, turn on ‘Approve every mail before sending’ in Settings.",
        ),
        href: "/settings", cta: t("Settings dekho", "Open Settings"),
      }
      : {
        text: t(
          "Campaign chal raha hai. Nayi drafts Approve page pe aati hain: unhe padh ke approve karo, tabhi mail jayegi.",
          "The campaign is running. New drafts show up on the Approve page: read and approve them; only then does a mail go out.",
        ),
        href: "/review", cta: t("Approve page kholo", "Open Approve page"),
      };

  // what to do next, depending on where the campaigns stand
  const nextIsImport = !draft && !running && !paused && !available.length;
  const name = (n: string) => <b className="font-semibold text-slate-900">{n}</b>;
  const next: ComponentProps<typeof NextStep> = draft
    ? draft.remaining
      ? {
        text: t(
          <>{name(draft.c.name)} ke 5 sample drafts banao, unhe padho aur start karo.</>,
          <>Make 5 sample drafts for {name(draft.c.name)}, read them and start the campaign.</>,
        ),
        href: `/campaigns/${draft.c.id}`, cta: t("Campaign kholo", "Open campaign"),
      }
      : {
        text: t(
          <>{name(draft.c.name)} mein abhi koi Ready lead nahi hai, isliye samples nahi ban sakte. Campaign kholo: wahan likha hai aage kya karna hai.</>,
          <>{name(draft.c.name)} has no Ready lead right now, so no samples can be made. Open the campaign: it says what to do next.</>,
        ),
        href: `/campaigns/${draft.c.id}`, cta: t("Campaign kholo", "Open campaign"), tone: "amber",
      }
    : running
      ? runningNext
      : paused
        ? {
          text: t(
            <>{name(paused.name)} ruka hua hai. Taiyaar ho to campaign kholo aur ‘Resume karo’ dabao.</>,
            <>{name(paused.name)} is paused. When you are ready, open the campaign and press ‘Resume’.</>,
          ),
          href: `/campaigns/${paused.id}`, cta: t("Campaign kholo", "Open campaign"), tone: "amber",
        }
        : nextIsImport
          ? {
            text: campaigns.length
              ? t("Naya campaign banane ke liye nayi leads chahiye. Pehle leads ki list import karo.", "A new campaign needs new leads. First import a list of leads.")
              : t("Shuru karne ke liye pehle leads ki list import karo. Uske baad yahan campaign banega.", "To get started, first import a list of leads. After that you can create a campaign here."),
            href: "/import", cta: t("Leads import karo", "Import leads"),
          }
          : { text: t("Neeche form mein list chuno aur ‘Campaign banao’ dabao. Uske baad 5 sample drafts banenge.", "Choose a list in the form below and press ‘Create campaign’. After that, 5 sample drafts will be made.") };

  const form = (
    <Section
      id="naya-campaign"
      title={t("Naya campaign banao", "Create a new campaign")}
      icon="plus"
      info={t(
        "List chuno, bhasha aur timezone check karo, aur ‘Mail kaise banegi’ chuno: website ke hisaab se 2 templates (jinki website NAHI hai unhe ek, jinki HAI unhe doosra), AI, ya ek template sabke liye. Phir ‘Campaign banao’ dabao. List ke saare free leads is campaign mein jud jaate hain. Banane se koi mail nahi jaati: pehle 5 samples banenge, jinhe aap padhoge.",
        "Choose a list, check the language and timezone, and choose ‘How mails are written’: two templates by website (one for leads without a website, another for leads with one), the AI, or one template for everyone. Then press ‘Create campaign’. All free leads of the list are added to this campaign. Creating it sends no mail: first 5 samples are made for you to read.",
      )}
      sub={t("Sirf wahi lists dikhti hain jinke leads abhi kisi campaign mein nahi hain.", "Only lists whose leads are not in a campaign yet are shown.")}
    >
      <CampaignForm lists={available} templates={templates} />
    </Section>
  );

  const COL = {
    name: t("Naam", "Name"),
    list: t("List", "List"),
    lang: t("Bhasha / Timezone", "Language / Timezone"),
    sent: t("Bheji", "Sent"),
    left: t("Baaki", "Remaining"),
    finish: t("Kab tak khatam", "Est. finish"),
  };

  const table = (
    <Section
      flush
      title={t("Saare campaigns", "All campaigns")}
      icon="megaphone"
      info={t(
        "Har campaign ka haal: kitni mails gayi (Bheji), kitni baaki hain (Baaki) aur andaza kab tak sab chali jayengi. Date sirf chalte campaign ki dikhti hai. Detail aur controls ke liye campaign ke naam pe click karo.",
        "Where each campaign stands: how many mails went out (Sent), how many are left (Remaining) and an estimate of when all will have gone. The date shows only for a running campaign. Click a campaign's name for details and controls.",
      )}
      sub={newest.length ? t(`${newest.length} campaign · naye sabse upar`, `${newest.length} ${newest.length === 1 ? "campaign" : "campaigns"} · newest first`) : undefined}
    >
      {newest.length ? (
        <div className="overflow-x-auto">
          <table className="tbl tbl-stack">
            <thead>
              <tr><th>{COL.name}</th><th>Status</th><th>{COL.list}</th><th>{COL.lang}</th><th className="md:!text-right">{COL.sent}</th><th className="md:!text-right">{COL.left}</th><th>{COL.finish}</th></tr>
            </thead>
            <tbody>
              {newest.map(({ c, remaining, sent, finish }) => {
                const mt = mailTypeOf(c);
                const total = sent + remaining;
                const pct = c.status === "done" ? 1 : total ? sent / total : 0;
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="min-w-0">
                        <Link href={`/campaigns/${c.id}`} className="link break-words">{c.name}</Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-400">
                          <span>{t("Banaya", "Created")}: {fmtDate(c.createdAt)}</span>
                          <span aria-hidden>·</span>
                          <span className="inline-flex min-w-0 items-center gap-1" title={`${t("Mail kaise banti hai", "How mails are written")}${mt.detail ? `\n${mt.detail}` : ""}`}>
                            <Icon name={mt.ai ? "bot" : "file"} size={11} className="shrink-0" /><span className="break-words">{mt.label}</span>
                          </span>
                        </div>
                      </div>
                    </td>
                    <td data-label="Status"><Badge v={c.status} /></td>
                    <td data-label={COL.list}><span className="break-words">{listNames.get(c.listId) || "—"}</span></td>
                    <td data-label={COL.lang}><span className="whitespace-nowrap">{c.language.toUpperCase()} · {c.timezone}</span></td>
                    <td data-label={COL.sent} className="tabular-nums md:text-right">{sent}</td>
                    <td data-label={COL.left} className="tabular-nums md:text-right">{remaining}</td>
                    <td data-label={COL.finish}>
                      <div className="min-w-0">
                        <div className="whitespace-nowrap">{c.status === "done" ? t("Poora ho gaya", "Finished") : c.status === "running" ? fmtDate(finish) : c.status === "paused" ? t("Ruka hua", "Paused") : t("Start ke baad", "Once started")}</div>
                        <div className="mt-1.5 flex items-center justify-end gap-2 md:justify-start" title={t(`${sent} bheji, ${remaining} baaki`, `${sent} sent, ${remaining} remaining`)}>
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
        <EmptyState icon="megaphone" title={t("Abhi koi campaign nahi", "No campaigns yet")}
          text={available.length
            ? t("Upar wale form se pehla campaign banao.", "Create your first campaign with the form above.")
            : t("Leads import hone ke baad yahan pehla campaign banega.", "Once leads are imported, your first campaign can be created here.")} />
      )}
    </Section>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Campaigns"
        info={auto
          ? t(
            "Campaign = ek lead list + bhasha + timezone + mail ka tareeka (AI ya templates). Flow: campaign banao → 5 sample drafts banao → unhe padh ke approve karke start karo → uske baad nayi drafts apne aap approve hoti hain (Settings mein auto-approve on hai) → worker sending window mein dheere-dheere bhejta hai.",
            "Campaign = one lead list + language + timezone + how mails are written (the AI or templates). Flow: create a campaign → make 5 sample drafts → read them, approve and start → after that, new drafts are approved automatically (auto-approve is on in Settings) → the worker sends slowly within the sending window.",
          )
          : t(
            "Campaign = ek lead list + bhasha + timezone + mail ka tareeka (AI ya templates). Flow: campaign banao → 5 sample drafts banao → unhe padh ke approve karke start karo → baaki har mail Approve page pe approve karo → worker sending window mein dheere-dheere bhejta hai.",
            "Campaign = one lead list + language + timezone + how mails are written (the AI or templates). Flow: create a campaign → make 5 sample drafts → read them, approve and start → approve every other mail on the Approve page → the worker sends slowly within the sending window.",
          )}
        sub={auto
          ? t(
            "Lead list se campaign banao. Pehle 5 samples aap approve karte ho; uske baad auto-approve on hai, mails apne aap jaati hain (Settings mein badal sakte ho).",
            "Create a campaign from a lead list. You approve the first 5 samples; after that, auto-approve is on and mails go out automatically (you can change this in Settings).",
          )
          : t("Lead list se campaign banao. Aapke approve kiye bina koi mail nahi jaati.", "Create a campaign from a lead list. No mail goes out without your approval.")}
      />
      <NextStep {...next} />
      {/* a free list → the form comes first; otherwise the campaign list is what matters (and with nothing to import from, the NextStep above already points to Import) */}
      {available.length ? <>{form}{table}</> : <>{table}{!nextIsImport && form}</>}
    </div>
  );
}
