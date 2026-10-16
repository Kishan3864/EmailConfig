import Link from "next/link";
import type { ComponentProps } from "react";
import { C, count, rows, type Campaign, type LeadList } from "@/lib/fsdb";
import { getSettings } from "@/lib/settings";
import { getT } from "@/lib/i18n-server";
import { countryInfo } from "@/lib/lang";
import { estimateFinish } from "@/lib/schedule";
import { TEMPLATE_IDS, mailPlan, templateLabel, templateOf, type TemplateId } from "@/lib/templates";
import { hasOwnWebsite } from "@/lib/website";
import { fmtDate } from "@/lib/time";
import { siteGroup } from "@/components/siteText";
import { Badge, EmptyState, NextStep, PageHeader, Progress, Section } from "@/components/ui";
import { Icon } from "@/components/icons";
import { tryTemplate } from "../settings/template-check";
import { CampaignForm, type TemplateChoice } from "./CampaignForm";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Campaigns", "Campaigns") };
}

/** {{observation}} (with or without a |fallback): a lead without one gets a "Text chahiye" draft (lib/templates.ts fillForLead). */
const OBSERVATION = /\{\{\s*observation\s*(?:\|[^}]*)?\}\}/i;
const filled = (v: unknown) => !!String(v ?? "").trim();

export default async function Campaigns() {
  const { t } = await getT();
  const s = await getSettings();
  const campaigns = rows<Campaign>(await C.campaigns.get()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lists = rows<LeadList>(await C.lists.where("confirmed", "==", true).get());
  const listNames = new Map(lists.map((l) => [l.id, l.name]));
  // only the leads still in no campaign are read (every lead is imported with campaignId null), so a list whose leads
  // are all in a campaign costs one read instead of all of its leads on every render
  const listInfo = await Promise.all(lists.map(async (l) => {
    const snap = await C.leads.where("listId", "==", l.id).where("campaignId", "==", null)
      .select("status", "country", "website", "observation", "customSubject", "customBody").get();
    const leads = snap.docs.filter((d) => ["ready", "needs_review"].includes(d.get("status")));
    const freq = new Map<string, number>();
    for (const x of leads) if (x.get("country")) freq.set(x.get("country"), (freq.get(x.get("country")) || 0) + 1);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const ci = countryInfo(top);
    const review = leads.filter((x) => x.get("status") === "needs_review").length;
    // for a "by website" campaign: how many of the free leads are in which group; own = leads with their own subject + body
    // in the file (they get that text, not a template); noObs = template leads of a group without an {{observation}}
    let site = 0, own = 0;
    const noObs = { nosite: 0, site: 0 };
    for (const x of leads) {
      const has = hasOwnWebsite(x.get("website"));
      if (has) site++;
      if (filled(x.get("customSubject")) && filled(x.get("customBody"))) own++;
      else if (!filled(x.get("observation"))) noObs[has ? "site" : "nosite"]++;
    }
    return { id: l.id, name: l.name, count: leads.length, review, noSite: leads.length - site, site, own, noObs, language: ci?.language || "en", timezone: ci?.timezone || "Europe/Paris" };
  }));

  let ahead = 0;
  const out = [];
  for (const c of campaigns) {
    const msgs = C.messages.where("campaignId", "==", c.id);
    // waiting = drafts waiting for my own Approve, needsText = drafts waiting for my words ([OBSERVATION], a broken
    // rule or a failed AI draft); a finished campaign has no Ready lead left, so neither (no reads spent on it)
    const [remaining, sent, waiting, needsText] = await Promise.all([
      count(C.leads.where("campaignId", "==", c.id).where("status", "==", "ready")),
      count(C.leads.where("campaignId", "==", c.id).where("status", "in", ["sent", "replied", "bounced", "opted_out"])),
      c.status === "done" ? 0 : count(msgs.where("status", "==", "ready").where("approved", "==", false)),
      c.status === "done" ? 0 : count(msgs.where("status", "==", "needs_text")),
    ]);
    const finish = c.status === "done" ? null : await estimateFinish(s, c.timezone, remaining, ahead);
    if (c.status === "running") ahead += remaining;
    out.push({ c, remaining, sent, waiting, needsText, finish });
  }

  const available = listInfo.filter((l) => l.count > 0);
  // the six Settings templates for the form: its group tag, its language (set in Settings, else read from its text) and
  // the language its text is really written in, whether it passes the draft rules in its set language (so a text in
  // another language fails, as in Settings; a template for leads with a website is filled with an example lead that
  // has one, for {{website}}) and whether it needs a real {{observation}}
  const templates: TemplateChoice[] = TEMPLATE_IDS.map((id) => {
    const x = templateOf(s, id);
    const r = tryTemplate(x.subject, x.body, s, true, x.for === "site", x.lang);
    return { id, name: x.name || "", lang: r.lang, textLang: r.textLang, ok: r.ok, for: x.for, observation: OBSERVATION.test(`${x.subject}\n${x.body}`) };
  });
  // "AI", "Template 2: More enquiries" or "Website ke hisaab se: T3, T5 + T4" (a campaign without a mailType is an AI
  // campaign); detail = which templates go to which group, for the tooltip
  const mailTypeOf = (c: Campaign): { label: string; detail?: string; ai: boolean } => {
    const p = mailPlan(c);
    if (p.kind === "ai") return { label: "AI", ai: true };
    if (p.kind === "one") return { label: templateLabel(s, p.id), ai: false };
    const same = p.nosite.join() === p.site.join();
    if (same && p.site.length === 1) return { label: templateLabel(s, p.site[0]), ai: false };
    const short = (ids: TemplateId[]) => ids.map((id) => `T${id.slice(3)}`).join(", ");
    const set = same ? short(p.site) : `${short(p.nosite)} + ${short(p.site)}`;
    const names = (ids: TemplateId[]) => ids.map((id) => `\n• ${templateLabel(s, id)}`).join("");
    return {
      label: t(`Website ke hisaab se: ${set}`, `By website: ${set}`),
      detail: t(
        `${siteGroup(false, t)}:${names(p.nosite)}\n${siteGroup(true, t)}:${names(p.site)}\nHar group ke leads ko uske templates baari-baari se milte hain.`,
        `${siteGroup(false, t)}:${names(p.nosite)}\n${siteGroup(true, t)}:${names(p.site)}\nThe leads of each group get its templates in turn.`,
      ),
      ai: false,
    };
  };
  const newest = out.reverse(); // newest first
  const draft = newest.find((x) => x.c.status === "draft");
  const paused = newest.find((x) => x.c.status === "paused")?.c;
  const live = newest.filter((x) => x.c.status === "running");
  const running = live.length > 0;
  // drafts of running campaigns waiting for me (a not-started campaign's samples wait for its Start first)
  const toApprove = live.reduce((n, x) => n + x.waiting, 0);
  const toWrite = live.reduce((n, x) => n + x.needsText, 0);
  const drafts = (n: number) => (n === 1 ? "draft" : "drafts");

  // a running campaign: the worker makes a draft for every Ready lead; nothing is sent until I approve it myself
  const dry = s.dryRun;
  const runningNext: ComponentProps<typeof NextStep> = toApprove || toWrite
    ? {
      text: t(
        (toApprove ? `${toApprove} drafts aapke approval ka intezaar kar rahi hain. ` : "")
        + (toWrite ? `${toWrite} drafts mein pehle aapka text chahiye ([OBSERVATION] likhna hai, ya text koi rule tod raha hai): ‘Text edit karo’ se theek karo, save karo, phir approve karo. ` : "")
        + "Approve page pe padh ke approve karo: approve hote hi mail sending window mein apne aap jayegi"
        + (dry ? ", par DRY-RUN mein sirf aapke test address pe, leads ko nahi." : "."),
        (toApprove ? `${toApprove} ${drafts(toApprove)} ${toApprove === 1 ? "is" : "are"} waiting for your approval. ` : "")
        + (toWrite ? `${toWrite} ${drafts(toWrite)} first need${toWrite === 1 ? "s" : ""} your text (the [OBSERVATION] part, or a rule the text breaks): fix it with ‘Edit text’, save, then approve. ` : "")
        + "Read and approve them on the Approve page: once approved, a mail goes out by itself within the sending window"
        + (dry ? ", but in DRY-RUN only to your test address, not to the leads." : "."),
      ),
      // only text to write: straight to the ‘Needs your text’ tab
      ...(toApprove
        ? { href: "/review", cta: t("Approve page kholo", "Open Approve page") }
        : { href: "/review?s=text", cta: t("Text likho", "Write the text"), tone: "amber" as const }),
    }
    : dry
      ? {
        text: t(
          "Campaign DRY-RUN mein chal raha hai. Worker har Ready lead ka draft bana raha hai (thode-thode karke); nayi drafts Approve page pe aayengi. Approve ki hui mails sirf aapke test address pe jaati hain, leads ko nahi. Sab theek ho to Dashboard se LIVE karo.",
          "The campaign is running in DRY-RUN. The worker is making a draft for every Ready lead, a batch at a time; new drafts show up on the Approve page. Approved mails go only to your test address, not to the leads. If all looks good, switch to LIVE on the Dashboard.",
        ),
        href: "/#mode", cta: t("Mode dekho", "See mode"),
      }
      : {
        text: t(
          "Campaign chal raha hai. Worker har Ready lead ka draft bana raha hai (thode-thode karke); nayi drafts Approve page pe aayengi. Aapke approve kiye bina koi mail nahi jaati.",
          "The campaign is running. The worker is making a draft for every Ready lead, a batch at a time; new drafts show up on the Approve page. No mail goes out without your approval.",
        ),
        href: `/campaigns/${live[0]?.c.id}`, cta: t("Campaign kholo", "Open campaign"),
      };

  // what to do next, depending on where the campaigns stand (drafts waiting for me come first: nothing goes out without them)
  const nextIsImport = !draft && !running && !paused && !available.length;
  const name = (n: string) => <b className="font-semibold text-slate-900">{n}</b>;
  const next: ComponentProps<typeof NextStep> = running && (toApprove || toWrite)
    ? runningNext
    : draft
      ? draft.remaining
        ? {
          text: t(
            <>{name(draft.c.name)} abhi Draft hai. Campaign kholo aur ‘Campaign start karo’ dabao: start se koi mail approve nahi hoti, worker har Ready lead ka draft banata hai aur aap unhe Approve page pe khud approve karte ho. Chaho to start se pehle 5 sample drafts dekh lo.</>,
            <>{name(draft.c.name)} is still a draft. Open the campaign and press ‘Start campaign’: starting approves nothing, the worker makes a draft for every Ready lead and you approve them yourself on the Approve page. If you like, look at 5 sample drafts before starting.</>,
          ),
          href: `/campaigns/${draft.c.id}`, cta: t("Campaign kholo", "Open campaign"),
        }
        : {
          text: t(
            <>{name(draft.c.name)} mein abhi koi Ready lead nahi hai, isliye ye start nahi ho sakta. Campaign kholo: wahan likha hai aage kya karna hai.</>,
            <>{name(draft.c.name)} has no Ready lead right now, so it cannot start. Open the campaign: it says what to do next.</>,
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
            : {
              text: t(
                "Neeche form mein list chuno aur ‘Campaign banao’ dabao. Banane se koi mail nahi banti ya jaati: uske baad campaign page pe start karo (chaho to pehle 5 sample drafts dekh lo).",
                "Choose a list in the form below and press ‘Create campaign’. Creating it makes and sends no mail: then start it on the campaign page (you can look at 5 sample drafts first if you like).",
              ),
            };

  const form = (
    <Section
      id="naya-campaign"
      title={t("Naya campaign banao", "Create a new campaign")}
      icon="plus"
      info={t(
        "List chuno, bhasha aur timezone check karo, aur ‘Mail kaise banegi’ chuno: website ke hisaab se templates (‘Bina website’ aur ‘Website hai’ group ke liye 1–3 templates har ek, jo baari-baari se jaate hain), AI, ya ek template sabko. Phir ‘Campaign banao’ dabao. List ke saare free leads is campaign mein jud jaate hain. Banane se koi mail nahi banti ya jaati: campaign page pe start karo (chaho to pehle 5 sample dekho). Start ke baad worker har lead ka draft banata hai, aur har mail aap khud Approve page pe approve karte ho.",
        "Choose a list, check the language and timezone, and choose ‘How mails are written’: templates by website (1–3 templates each for the ‘No website’ and ‘Has a website’ groups, used in turn), the AI, or one template for everyone. Then press ‘Create campaign’. All free leads of the list are added to this campaign. Creating it makes and sends no mail: start it on the campaign page (look at 5 samples first if you like). After the start the worker makes a draft for every lead, and you approve every mail yourself on the Approve page.",
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
        "Har campaign ka haal: kitni mails gayi (Bheji), kitne leads baaki hain (Baaki) aur andaza kab tak sab chali jayengi. Status ke neeche: kitni drafts aapke approval ka intezaar kar rahi hain, aur kitni mein pehle aapka text chahiye. Date sirf chalte campaign ki dikhti hai, aur maan ke chalti hai ki aap drafts time pe approve karte raho: approve kiye bina koi mail nahi jaati. Detail aur controls ke liye campaign ke naam pe click karo.",
        "Where each campaign stands: how many mails went out (Sent), how many leads are left (Remaining) and an estimate of when all will have gone. Under the status: how many drafts are waiting for your approval, and how many first need your text. The date shows only for a running campaign and assumes you keep approving drafts in time: no mail goes out without your approval. Click a campaign's name for details and controls.",
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
              {newest.map(({ c, remaining, sent, waiting, needsText, finish }) => {
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
                    <td data-label="Status">
                      <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 md:flex-col md:items-start md:justify-start">
                        <Badge v={c.status} />
                        {waiting > 0 && (
                          <Link href={`/review?c=${c.id}`} className="whitespace-nowrap text-2xs font-medium text-amber-700 hover:underline">
                            {t(`${waiting} approval baaki`, `${waiting} to approve`)}
                          </Link>
                        )}
                        {needsText > 0 && (
                          <Link href={`/review?c=${c.id}&s=text`} className="whitespace-nowrap text-2xs font-medium text-amber-700 hover:underline">
                            {t(`${needsText} mein text chahiye`, `${needsText} need${needsText === 1 ? "s" : ""} your text`)}
                          </Link>
                        )}
                      </div>
                    </td>
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
        info={t(
          "Campaign = ek lead list + bhasha + timezone + mail ka tareeka (AI ya templates). Flow: campaign banao → (chaho to) 5 sample drafts dekho → ‘Campaign start karo’ (isse koi mail approve nahi hoti) → worker har Ready lead ka draft banata hai → aap har mail Approve page pe padh ke khud approve karte ho (ye aakhri step hai) → approve ki hui mail sending window, gap aur daily limit ke andar apne aap jaati hai.",
          "Campaign = one lead list + language + timezone + how mails are written (the AI or templates). Flow: create a campaign → (if you like) look at 5 sample drafts → ‘Start campaign’ (this approves nothing) → the worker makes a draft for every Ready lead → you read and approve every mail yourself on the Approve page (this is the last step) → an approved mail goes out by itself within the sending window, gap and daily limit.",
        )}
        sub={t(
          "Lead list se campaign banao. Saari mails pehle banti hain; aapke khud approve kiye bina koi mail nahi jaati.",
          "Create a campaign from a lead list. All mails are made first; no mail goes out without your own approval.",
        )}
      />
      <NextStep {...next} />
      {/* a free list → the form comes first; otherwise the campaign list is what matters (and with nothing to import from, the NextStep above already points to Import) */}
      {available.length ? <>{form}{table}</> : <>{table}{!nextIsImport && form}</>}
    </div>
  );
}
