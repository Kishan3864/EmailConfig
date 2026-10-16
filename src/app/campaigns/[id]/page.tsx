import Link from "next/link";
import type { ComponentProps } from "react";
import { notFound } from "next/navigation";
import { C, count, db, rows, type Campaign, type Message, type LeadList } from "@/lib/fsdb";
import { getSettings } from "@/lib/settings";
import { getT } from "@/lib/i18n-server";
import { capFor, priorSendingDays } from "@/lib/schedule";
import { pipeline, queueEstimate } from "@/lib/campaign";
import { fullText } from "@/lib/compose";
import { LOGO_HEIGHT, LOGO_PNG_BASE64, LOGO_WIDTH } from "@/lib/logo";
import { isTemplateId, mailPlan, missingMark, planTemplates, templateForLead, templateLabel, templateOf, templatesForLead, tplNo, type TemplateId } from "@/lib/templates";
import { siteStatus } from "@/lib/website";
import { englishOf } from "@/lib/english";
import { LANGS } from "@/lib/lang";
import { fmt, fmtDate } from "@/lib/time";
import { Badge, Callout, EmptyState, MailPreview, NextStep, PageHeader, Section, Stat, Steps, type StepState } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { EnglishMail } from "@/components/EnglishMail";
import { Info } from "@/components/Info";
import { Icon } from "@/components/icons";
import { forText, siteGroup, siteText } from "@/components/siteText";
import { ToastOnMount } from "@/components/toast";
import { samplesAction, startCampaign, pauseCampaign, resumeCampaign, regenerateDraft, translateMessage } from "../../actions";
import { ruleText } from "../../settings/template-check";

// lead statuses counted here; "sent" itself comes from pipeline() (sent + replied + bounced + opted out)
const STATUSES = ["ready", "needs_review", "replied", "bounced", "opted_out", "check_manual", "already_contacted"];

// Control buttons: full width on phones, and long labels may wrap instead of overflowing.
const WIDE = "h-auto min-h-9 w-full whitespace-normal py-1.5 text-center sm:min-h-8 sm:w-auto";

// The footer source the sender uses when the list has no "Kahan se mile" note (same fallback as sender.ts).
const NO_SOURCE = "a public business directory";
// Message statuses that have not gone out yet: shown the way they will go.
const UNSENT = ["ready", "sending", "retry"];
// What a "Text chahiye" draft shows where the lead's observation is missing: [OBSERVATION]
const OBS = missingMark("observation");

/** A stored message. When it goes out, the sender saves the exact text (sentText) and whether the logo went with it. */
type Row = Message & { sentText?: string; sentWithLogo?: boolean };

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Campaign", "Campaign") };
}

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const { t } = await getT();
  const cd = await C.campaigns.doc(id).get();
  if (!cd.exists) notFound();
  const c = { id, ...cd.data() } as Campaign;
  // samplesApproved is the older name of "started" (lib/campaign.ts): starting approves nothing
  const started = !!c.samplesApproved;
  const [list, s] = await Promise.all([
    C.lists.doc(c.listId).get().then((d) => d.data() as LeadList | undefined),
    getSettings(),
  ]);
  const [p, counts] = await Promise.all([
    // where every lead stands, from "draft still to make" to "sent": counts only (cheap on reads). In DRY-RUN the queue
    // holds only approved mails not yet sent to the test address; the ones already sent there are dryDone
    pipeline(id, s.dryRun),
    Promise.all(
      STATUSES.map(async (st) => [st, await count(C.leads.where("campaignId", "==", id).where("status", "==", st))] as const),
    ).then((x) => Object.fromEntries(x) as Record<string, number>),
  ]);
  // DRY-RUN: approved mails that already went to my test address; they go to the leads only after LIVE
  const dryDone = s.dryRun ? p.dryDone : 0;
  const remaining = counts.ready;
  const done = c.status === "done";
  const running = c.status === "running";
  const paused = c.status === "paused";
  // when the approved send queue should be out, with today's limits (only a running campaign sends); p.queued is the
  // DRY-RUN-aware queue, so mails already sent to the test address are not counted again
  const est = running && p.queued > 0 ? await queueEstimate(s, c, p.queued) : null;
  const cap = capFor(s, await priorSendingDays(c.timezone));
  const messages = rows<Row>(await C.messages.where("campaignId", "==", id).orderBy("createdAt", "desc").limit(started ? 30 : 5).get());
  const failing = (await C.draftJobs.where("campaignId", "==", id).limit(10).get()).docs.map((d) => ({
    id: d.id, attempts: d.get("attempts") as number | undefined, nextTryAt: d.get("nextTryAt") as string | undefined, lastError: d.get("lastError") as string | undefined,
  }));
  // how the mails are made: the AI (also when mailType is missing), one Settings template for every lead, or 1-3
  // templates per website group, used in turn ("by website"); templates are filled in without the AI (lib/templates.ts)
  const plan = mailPlan(c);
  const bySite = plan.kind === "bysite" ? plan : null;
  // the lead of each failed draft (own CSV text? website?) and, "by website", of each shown mail: at most 40 leads, one read
  const leadOf = new Map<string, { website: string | null; own: boolean }>();
  const leadIds = [...new Set([...(bySite ? messages.map((m) => m.leadId || m.id) : []), ...failing.map((f) => f.id)])];
  if (leadIds.length) {
    for (const d of await db.getAll(...leadIds.map((x) => C.leads.doc(x)), { fieldMask: ["website", "customSubject", "customBody"] })) {
      if (!d.exists) continue;
      const has = (k: string) => !!String(d.get(k) || "").trim();
      leadOf.set(d.id, { website: (d.get("website") as string | undefined) || null, own: has("customSubject") && has("customBody") });
    }
  }
  // "by website": how the campaign's leads split between the two groups, counted once by createCampaign
  // (counting here would read every lead on every view, too many reads for the free Firestore plan)
  const split = bySite && c.siteSplit && !done ? c.siteSplit : null;

  // Before the start: samples (optional) and Start need at least one Ready lead.
  const canStart = !started && remaining > 0;
  const want = Math.min(5, remaining);
  const partial = canStart && messages.length > 0 && messages.length < want; // some samples failed
  // the owner's own work: drafts waiting for their approval or their text
  const ownerTodo = p.waiting + p.needsText;
  const reviewHref = `/review?c=${id}`;
  const textHref = `/review?c=${id}&s=text`;
  const sentHref = s.dryRun ? "/sent?mode=dry" : "/sent";
  // A finished campaign never mails the leads still in it, not even ones approved later.
  const stuck = done ? counts.needs_review + remaining : 0;
  // English plurals ("1 lead", "2 leads"); Hinglish keeps one form
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  // one broken draft rule of a "Text chahiye" mail, in the UI language; the language rule is said for a mail (its text
  // must be in the campaign language), not for a template's Language setting
  const ruleLine = (e: string) => {
    const l = e.match(/^language looks like "([^"]+)", expected "([^"]+)"$/);
    if (!l) return ruleText(e, t);
    const [found, want] = [LANGS[l[1]] || l[1].toUpperCase(), LANGS[l[2]] || l[2].toUpperCase()];
    return t(`Text ${found} mein lagta hai, par campaign ${want} mein hai: text ${want} mein likho`, `The text looks like ${found}, but the campaign is in ${want}: write it in ${want}`);
  };
  const isTpl = plan.kind !== "ai";
  const tpls = planTemplates(plan);
  const manyTpls = tpls.length > 1; // "by website" with more than one template
  // "T3, T5" (short, for the header) and "Template 3: name; Template 5: name" (for the (i) texts)
  const short = (ids: TemplateId[]) => ids.map((x) => `T${x.slice(3)}`).join(", ");
  const names = (ids: TemplateId[]) => ids.map((x) => templateLabel(s, x)).join("; ");
  // "Template 3" for a one-template campaign; with several, the failed lead's own line says which
  const tplWord = plan.kind === "one" ? tplNo(plan.id) : t("Template", "The template");
  // "Template 3 (‘name’)"
  const named = (x: TemplateId) => { const n = templateOf(s, x).name.trim(); return `${tplNo(x)}${n ? ` (‘${n}’)` : ""}`; };
  const mailType = plan.kind === "one" ? templateLabel(s, plan.id)
    : bySite
      ? t(
        `Website ke hisaab se: ${siteGroup(false, t)} → ${short(bySite.nosite)} · ${siteGroup(true, t)} → ${short(bySite.site)}`,
        `By website: ${siteGroup(false, t)} → ${short(bySite.nosite)} · ${siteGroup(true, t)} → ${short(bySite.site)}`,
      )
      : "AI";
  // the lead's own subject + body from the import file win over a template or the AI (lib/drafts.ts)
  const ownNote = t(
    "Jis lead ki CSV mein apna subject aur body dono hain, use template ya AI ki jagah wahi text jaata hai (wahi rules check hote hain).",
    "A lead whose CSV row has its own subject and body gets that text instead of a template or the AI (the same rules are checked).",
  );
  const obsNote = t(
    `{{observation}} kabhi |fallback se nahi bharta: lead ki observation na ho to draft ‘Text chahiye’ mein rukti hai, text mein ${OBS} likha hota hai aur wo hissa aap khud likhte ho.`,
    `{{observation}} is never filled from a |fallback: when the lead has no observation, the draft waits as ‘Needs your text’ with ${OBS} in its text, and you write that part yourself.`,
  );
  const editNote = t(
    "Text Settings → Email templates mein hai. Wahan badloge to nayi drafts naye text se banengi; pehle bani draft ke liye us par ‘Template se dobara banao’ dabao (wahi template rehta hai).",
    "The text is in Settings → Email templates. If you change it there, new drafts use the new text; for a draft made earlier, press ‘Rebuild from template’ on it (it keeps the same template).",
  );
  const mailTypeInfo = plan.kind === "one"
    ? t(
      `Is campaign ki har mail ${named(plan.id)} se banti hai, AI se nahi: sabko same text, sirf {{business}}, {{contact}}, {{city}}, {{reviews}}, {{rating}}, {{observation}} jaise placeholders lead ki details se bharte hain.\n${obsNote}\n${ownNote}\n${editNote}`,
      `Every mail of this campaign is made from ${named(plan.id)}, not by the AI: the same text for everyone, with placeholders like {{business}}, {{contact}}, {{city}}, {{reviews}}, {{rating}}, {{observation}} filled in from the lead's details.\n${obsNote}\n${ownNote}\n${editNote}`,
    )
    : bySite
      ? t(
        `Is campaign mein AI nahi likhta. App har lead ki website dekh ke uska group chunta hai aur us group ka template bharta hai:\n• ${forText("nosite", t)} → ${names(bySite.nosite)}\n• ${forText("site", t)} → ${names(bySite.site)}\nGroup mein ek se zyada template ho to us group ke leads ko wo baari-baari se milte hain (pehle ko pehla, doosre ko doosra…), taaki sab barabar bate.\nSirf Facebook / Instagram page, Google Maps, directory, booking ya delivery link, ya free builder page (jaise wixsite.com, eatbu.com) apni website nahi maana jaata: aise lead ko bhi bina website wala template jaata hai.\n${obsNote}\n${ownNote}\n${editNote}`,
        `This campaign does not use the AI. The app looks at each lead's website, picks its group and fills in that group's template:\n• ${forText("nosite", t)} → ${names(bySite.nosite)}\n• ${forText("site", t)} → ${names(bySite.site)}\nWhen a group has more than one template, its leads get them in turn (the first lead the first one, the second the second…), so they are shared evenly.\nOnly a Facebook / Instagram page, Google Maps, a directory, a booking or delivery link, or a free builder page (like wixsite.com, eatbu.com) does not count as a website of their own: such a lead also gets a no-website template.\n${obsNote}\n${ownNote}\n${editNote}`,
      )
      : t(
        `AI har lead ke liye alag mail likhta hai, sirf lead ki sach details se: CSV ki details (business, contact, category, city, about, note) aur unki apni website ka title/description. AI andaaza nahi lagata ki business kya karta hai, aur website pe kabhi comment nahi karta. Mail English mein na ho to uska English translation sirf aapke padhne ke liye dikhta hai.\n${ownNote}`,
        `The AI writes a separate mail for each lead, only from the lead's true details: the CSV details (business, contact, category, city, about, note) and the title/description of their own website. It never guesses what a business does and never comments on their website. When a mail is not in English, its English translation is shown only for you to read.\n${ownNote}`,
      );
  const writing = isTpl ? t("Template bhar rahe hain…", "Filling in the template…") : t("AI likh raha hai…", "AI is writing…");
  const fixLabel = manyTpls ? t("Templates theek karo", "Fix the templates") : t("Template theek karo", "Fix the template");
  const fixTemplate = <Link href="/settings#templates" className="btn btn-sm w-full sm:w-auto">{fixLabel}<Icon name="arrow-right" size={13} /></Link>;
  // how the optional samples are made, in one clause
  const sampleHow = plan.kind === "one"
    ? t(`${tplNo(plan.id)} list ke pehle 5 leads ke liye bhara jaata hai (AI nahi likhta)`, `${tplNo(plan.id)} is filled in for the first 5 leads of the list (the AI does not write them)`)
    : bySite
      ? t("list ke pehle 5 leads ke liye unki website ke group ka template bhara jaata hai (AI nahi likhta)", "a template of their website group is filled in for the first 5 leads of the list (the AI does not write them)")
      : t("AI list ke pehle 5 leads ke liye mail likhta hai", "the AI writes a mail for the first 5 leads of the list");
  // the template a shown mail was made from: stored on the draft (tplId); null = the AI or the lead's own text.
  // Drafts from before tplId existed lack it, so it is worked out again from the lead's website.
  const tplOfMail = (m: Row): TemplateId | null => {
    if (m.custom) return null;
    if (isTemplateId(m.tplId)) return m.tplId;
    if (m.tplId !== undefined || plan.kind === "ai") return null;
    if (plan.kind === "one") return plan.id;
    const l = leadOf.get(m.leadId || m.id);
    return l ? templateForLead(c, l.website)?.id ?? null : null;
  };

  // 1 samples (optional preview) → 2 Start (approves nothing) → 3 the worker drafts every Ready lead
  // → 4 my own Approve, the last step → 5 approved mails go out by themselves within the limits.
  // Drafting, approving and sending run side by side, so more than one step can be "current".
  const steps: StepItem[] = [
    { label: t("Samples (optional)", "Samples (optional)"), state: started || messages.length ? "done" : remaining ? "current" : "todo" },
    { label: t("Start karo", "Start"), state: started ? "done" : messages.length && remaining ? "current" : "todo" },
    { label: t("Drafts ban rahe hain", "Drafts being made"), state: done || (started && !p.toCreate) ? "done" : started ? "current" : "todo" },
    { label: t("Approve karo", "Approve"), href: reviewHref, state: done ? "done" : !started ? "todo" : ownerTodo ? "current" : p.toCreate ? "todo" : "done" },
    { label: t("Apne aap bheji jayengi", "Sent automatically"), href: sentHref, state: done ? "done" : started && (p.queued || p.sent || dryDone) ? "current" : "todo" },
  ];
  // phones show one step: the owner's own (Approve) when it waits for them, else the first one in progress
  const phoneStep = done ? steps.length - 1 : steps[3].state === "current" ? 3 : Math.max(0, steps.findIndex((x) => x.state === "current"));

  const openApprove = t("Approve page kholo", "Open Approve page");
  const writeText = t("Text likho", "Write the text");
  const dryNote = s.dryRun
    ? t(" DRY-RUN on hai: approve ki hui mails sirf aapke test address pe jaati hain, leads ko nahi.", " DRY-RUN is on: approved mails go only to your test address, not to the leads.")
    : "";
  // the approved mails already sent to the test address: not in the queue, the worker does not send them again now
  const dryDoneNote = dryDone
    ? t(
      ` ${dryDone} approved mails test address pe ja chuki hain: wo LIVE karne ke baad hi leads ko jayengi (dobara approve nahi karna).`,
      ` ${plural(dryDone, "approved mail has", "approved mails have")} already gone to the test address: ${dryDone === 1 ? "it goes" : "they go"} to the leads only after you switch to LIVE (no need to approve again).`,
    )
    : "";
  const runningNext: ComponentProps<typeof NextStep> =
    p.waiting > 0
      ? {
        text: t(
          `${p.waiting} drafts aapke approve ka wait kar rahi hain${p.needsText ? ` (aur ${p.needsText} mein aapka text chahiye)` : ""}. Approve page pe padho aur approve karo: ye aakhri step hai. Approve hote hi mail send queue mein jaati hai aur limits ke andar apne aap bheji jaati hai.${dryNote}`,
          `${plural(p.waiting, "draft is", "drafts are")} waiting for your approval${p.needsText ? ` (and ${p.needsText} need your text)` : ""}. Read and approve them on the Approve page: this is the last step. Once approved, a mail is in the send queue and goes out by itself within the limits.${dryNote}`,
        ),
        href: reviewHref, cta: openApprove,
      }
      : p.needsText > 0
        ? {
          text: t(
            `${p.needsText} drafts mein aapka text chahiye (har mail pe wajah likhi hai: ${OBS} ki jagah apne shabd likhne hain, ya text mail ka koi rule tod raha hai${isTpl ? "" : ", ya AI 5 koshish mein draft nahi likh paya"}). Approve page pe ‘Text edit karo’ se theek karo, save karo, phir approve karo.`,
            `${plural(p.needsText, "draft needs", "drafts need")} your text (each mail says why: your own words in place of ${OBS}, or a mail rule the text breaks${isTpl ? "" : ", or an AI draft that failed 5 tries"}). On the Approve page fix it with ‘Edit text’, save, then approve.`,
          ),
          href: textHref, cta: writeText, tone: "amber",
        }
        : p.toCreate > 0
          ? {
            text: t(
              `Worker drafts bana raha hai: ${p.toCreate} leads ki draft abhi baaki hai (har minute template wali 50 tak, AI wali 3 tak). Bante hi wo Approve page pe ‘Approval baaki’ mein aayengi; koi bhi apne aap approve nahi hoti.${dryNote}`,
              `The worker is making drafts: ${plural(p.toCreate, "lead still needs", "leads still need")} one (up to 50 template drafts and 3 AI drafts a minute). They show up on the Approve page as ‘Awaiting approval’; none is ever approved by itself.${dryNote}`,
            ),
            href: reviewHref, cta: openApprove,
          }
          : p.queued > 0
            ? {
              text: t(
                `Saari drafts approve ho chuki hain. ${p.queued} approved mails queue mein hain: worker unhe sending window mein ek-ek karke apne aap bhejega${est ? ` (andaza: ${fmtDate(est)} tak)` : ""}.${dryNote}${dryDoneNote}`,
                `All drafts are approved. ${plural(p.queued, "approved mail is", "approved mails are")} in the queue: the worker sends them one by one in the sending window by itself${est ? ` (estimate: by ${fmtDate(est)})` : ""}.${dryNote}${dryDoneNote}`,
              ),
              href: sentHref, cta: t("Bheji mails dekho", "See sent mails"), tone: "emerald",
            }
            : dryDone > 0
              // DRY-RUN: everything approved already went to the test address; nothing more is sent until LIVE
              ? {
                text: t(
                  `Saari approve ki hui mails (${dryDone}) DRY-RUN mein aapke test address pe ja chuki hain, aur queue mein ab kuch nahi hai. Leads ko ye tabhi jayengi jab aap Dashboard se LIVE karoge; dobara approve nahi karna.`,
                  `All approved mails (${dryDone}) have gone to your test address in DRY-RUN, and nothing is left in the queue. They go to the leads only once you switch to LIVE on the Dashboard; no need to approve them again.`,
                ),
                href: "/#mode", cta: t("Mode dekho", "See mode"), tone: "emerald",
              }
              : {
                text: t(
                  `Abhi aapke liye kuch karna nahi hai: na koi draft approval ya text ka wait kar rahi hai, na queue mein koi mail hai.${dryNote}`,
                  `Nothing to do for you right now: no draft is waiting for your approval or text, and no mail is in the queue.${dryNote}`,
                ),
                href: sentHref, cta: t("Bheji mails dekho", "See sent mails"),
              };

  // what to do next on this campaign
  const next: ComponentProps<typeof NextStep> =
    !started && !remaining
      ? counts.needs_review > 0
        ? {
          text: t(
            `Is campaign mein abhi koi Ready lead nahi hai: ${counts.needs_review} leads ‘Review chahiye’ mein hain. Pehle Contacts page pe unhe approve karo, phir yahan samples banao ya campaign start karo.`,
            `This campaign has no Ready lead right now: ${plural(counts.needs_review, "lead is", "leads are")} in ‘Needs review’. First approve them on the Contacts page, then make samples or start the campaign here.`,
          ),
          href: "/contacts?status=needs_review", cta: t("Review wale leads dekho", "See leads to review"), tone: "amber",
        }
        : {
          text: t(
            "Is campaign mein bhejne layak koi lead nahi bacha (na Ready, na ‘Review chahiye’), isliye isse koi mail nahi jayegi. Nayi leads import karke naya campaign banao.",
            "This campaign has no lead left to mail (neither Ready nor ‘Needs review’), so it will not send any mail. Import new leads and create a new campaign.",
          ),
          href: "/import", cta: t("Leads import karo", "Import leads"), tone: "amber",
        }
      : !started && !messages.length
        ? {
          text: t(
            `Chaho to pehle neeche Controls mein ‘5 sample drafts banao’ dabao: ${sampleHow}. Ye sirf preview hai, koi mail approve nahi hoti. Phir (ya seedha) ‘Campaign start karo’ dabao: worker sabhi ${remaining} Ready leads ki drafts banayega, aur har mail aap khud Approve page pe approve karoge.`,
            `If you like, first press ‘Make 5 sample drafts’ in Controls below: ${sampleHow}. It is only a preview; no mail gets approved. Then (or right away) press ‘Start campaign’: the worker makes drafts for all ${plural(remaining, "Ready lead", "Ready leads")}, and you approve every mail yourself on the Approve page.`,
          ),
        }
        : partial
          ? isTpl
            // a template fails again until its text is fixed (also for every lead after the start), so the fix comes first
            ? {
              text: t(
                `Sirf ${messages.length}/${want} sample drafts bane. Wajah neeche error mein hai: aksar bhara hua template mail ke rules pass nahi karta, aur start ke baad bhi waisa hi hoga. ${manyTpls ? "Jo template fail hua (har lead ke saath likha hai), use" : "Template"} theek karo, phir Controls mein ‘5 sample drafts banao’ phir se dabao: sirf bache hue banenge.`,
                `Only ${messages.length}/${want} sample drafts were made. The reason is in the error below: usually the filled-in template does not pass the mail rules, and it would fail the same way after the start. Fix ${manyTpls ? "the template that failed (shown next to each lead)" : "the template"}, then press ‘Make 5 sample drafts’ in Controls again: only the missing ones are made.`,
              ),
              href: "/settings#templates", cta: fixLabel, tone: "amber",
            }
            : {
              text: t(
                `Sirf ${messages.length}/${want} sample drafts bane. Neeche Controls mein ‘5 sample drafts banao’ phir se dabao (sirf bache hue banenge), ya campaign start karo: start ke baad worker in leads ko apne aap dobara try karega.`,
                `Only ${messages.length}/${want} sample drafts were made. Press ‘Make 5 sample drafts’ in Controls below again (only the missing ones are made), or start the campaign: after the start the worker retries these leads by itself.`,
              ),
              tone: "amber",
            }
          : !started
            ? {
              text: t(
                "Neeche samples padho (sirf preview, ye approve nahi hue). Theek lagein to ‘Campaign start karo’ dabao: koi mail approve nahi hogi. Worker baaki Ready leads ki drafts banayega; har mail, ye samples bhi, aap khud Approve page pe approve karoge.",
                "Read the samples below (only a preview, they are not approved). If they look good, press ‘Start campaign’: no mail gets approved. The worker makes drafts for the other Ready leads; you approve every mail yourself on the Approve page, these samples too.",
              ),
              href: "#mails", cta: t("Samples padho", "Read samples"),
            }
            : running
              ? runningNext
              : paused
                ? {
                  text: t(
                    "Campaign ruka hua hai: na nayi drafts banengi, na koi mail jayegi. Approve page pe drafts phir bhi padh aur approve kar sakte ho; wo ‘Resume karo’ ke baad hi jayengi.",
                    "The campaign is paused: no new drafts are made and no mail goes out. You can still read and approve drafts on the Approve page; they go out only after you press ‘Resume’.",
                  ),
                  href: ownerTodo ? reviewHref : undefined, cta: ownerTodo ? openApprove : undefined, tone: "amber",
                }
                : done
                  ? { text: t("Campaign poora ho gaya. Ab replies dekho aur jawab do.", "The campaign is finished. Now read the replies and answer them."), href: "/replies", cta: t("Replies dekho", "See replies"), tone: "emerald" }
                  : { text: t("Bheji gayi mails ka poora record Sent page pe hai.", "The full record of sent mails is on the Sent page."), href: "/sent", cta: t("Bheji mails dekho", "See sent mails") };

  // one line about the buttons below it (NextStep already says what to do)
  const statusLine = !started
    ? !remaining ? t("Abhi koi Ready lead nahi hai, isliye na samples ban sakte hain na campaign start ho sakta hai.", "There is no Ready lead right now, so no samples can be made and the campaign cannot start.")
      : partial ? t(`${messages.length}/${want} sample drafts bane. Samples zaroori nahi hain; start karne se bhi koi mail approve nahi hoti.`, `${messages.length}/${want} sample drafts made. Samples are not required; starting does not approve any mail either.`)
        : messages.length
          ? t(
            `${messages.length} sample draft taiyaar hain (approve nahi hue). Start karne se bhi koi mail approve nahi hoti: worker baaki Ready leads ki drafts banayega aur har mail aap khud Approve page pe approve karoge.`,
            `${plural(messages.length, "sample draft is", "sample drafts are")} ready (not approved). Starting does not approve any mail either: the worker makes drafts for the other Ready leads and you approve every mail yourself on the Approve page.`,
          )
          : t(
            "Samples optional hain (sirf preview). Start karne se koi mail approve nahi hoti: har mail aap khud Approve page pe approve karoge.",
            "Samples are optional (only a preview). Starting approves no mail: you approve every mail yourself on the Approve page.",
          )
    : running
      ? t(
        `Worker har Ready lead ki draft banata hai aur sirf aapki approve ki hui mails sending window mein ek-ek karke bhejta hai${s.dryRun ? " (DRY-RUN mein sirf aapke test address pe)" : ""}. Rokna ho to Pause dabao.`,
        `The worker makes a draft for every Ready lead and sends only the mails you approved, one by one in the sending window${s.dryRun ? " (in DRY-RUN only to your test address)" : ""}. To stop, press Pause.`,
      )
      : paused ? t("Resume dabane tak is campaign se na nayi drafts banengi, na koi mail jayegi.", "Until you press Resume, this campaign makes no new drafts and sends no mail.")
        : done ? t("Campaign poora ho gaya: ab is campaign se koi mail nahi jayegi.", "The campaign is finished: no more mails will go out from it.") : "";
  const showControls = !done || counts.check_manual > 0 || counts.already_contacted > 0;

  // drafts that failed: only a running campaign retries them by itself
  const showFailing = failing.length > 0 && !done && (started || remaining > 0);
  // a template draft fails when the filled-in text breaks a mail rule: the fix is in Settings, retrying alone does not help
  // "by website": each failed lead shows its group and that group's templates
  const fixWhich = manyTpls
    ? t("Settings → Email templates mein wo template theek karo jo rules tod raha hai (har lead ke saath uske templates likhe hain)", "Fix the template that breaks the rules in Settings → Email templates (each lead shows its templates)")
    : t("Settings → Email templates mein template theek karo", "Fix the template in Settings → Email templates");
  const failText = isTpl
    ? !started
      ? t(
        `${tplWord} se in leads ka sample draft nahi ban paya. Wajah neeche error mein hai, aksar bhara hua text mail ke rules pass nahi karta. ${fixWhich}, phir Controls mein ‘5 sample drafts banao’ phir se dabao; sirf bache hue banenge.`,
        `${tplWord} could not make a sample draft for these leads. The reason is in the error below; usually the filled-in text does not pass the mail rules. ${fixWhich}, then press ‘Make 5 sample drafts’ in Controls again; only the missing ones are made.`,
      )
      : paused
        ? t(
          `${tplWord} se in leads ka draft nahi ban paya (error neeche hai). ${fixWhich}; ‘Resume karo’ dabane ke baad app apne aap dobara try karega.`,
          `${tplWord} could not make a draft for these leads (the error is below). ${fixWhich}; after you press ‘Resume’, the app retries automatically.`,
        )
        : t(
          `${tplWord} se in leads ka draft nahi ban paya (error neeche hai). ${fixWhich}; app thodi der baad apne aap dobara try karega.`,
          `${tplWord} could not make a draft for these leads (the error is below). ${fixWhich}; the app retries automatically in a little while.`,
        )
    : !started
      ? t(
        "AI in leads ke liye sample draft nahi likh paya. Start se pehle ye apne aap dobara try nahi hote: neeche Controls mein ‘5 sample drafts banao’ phir se dabao, sirf bache hue banenge.",
        "The AI could not write a sample draft for these leads. Before the start they are not retried automatically: press ‘Make 5 sample drafts’ in Controls below again; only the missing ones are made.",
      )
      : paused
        ? t(
          "AI in leads ke liye draft nahi likh paya. Campaign ruka hua hai, isliye abhi dobara try nahi hoga: ‘Resume karo’ dabane ke baad app apne aap dobara try karega.",
          "The AI could not write a draft for these leads. The campaign is paused, so there is no retry for now: after you press ‘Resume’, the app retries automatically.",
        )
        : t("AI in leads ke liye draft nahi likh paya. App thodi der baad apne aap dobara try karega.", "The AI could not write a draft for these leads. The app will retry automatically in a little while.");
  const forLeads = plural(failing.length, "lead", "leads");
  const failToast = !started
    ? {
      title: t("Kuch sample drafts nahi ban paye", "Some sample drafts could not be made"),
      text: t(`${failing.length} lead ke sample draft nahi bane. ‘5 sample drafts banao’ phir se dabao.`, `No sample draft was made for ${forLeads}. Press ‘Make 5 sample drafts’ again.`),
    }
    : paused
      ? {
        title: t("Kuch drafts nahi ban paye", "Some drafts could not be made"),
        text: t(`${failing.length} lead ke draft ruke hain. ‘Resume karo’ ke baad app dobara try karega.`, `The drafts for ${forLeads} are on hold. After ‘Resume’ the app will try again.`),
      }
      : {
        title: t("Kuch drafts nahi ban paye", "Some drafts could not be made"),
        text: t(`${failing.length} lead ke draft retry ke liye ruke hain. App apne aap dobara try karega.`, `The drafts for ${forLeads} are waiting for a retry. The app will retry automatically.`),
      };

  // Start approves NOTHING (lib/campaign.ts): it only lets the worker make the drafts; two clicks so it never happens by mistake
  const startButton = (wide: string) => (
    <ActionButton action={startCampaign.bind(null, id)} label={t("Campaign start karo (koi mail approve nahi hogi)", "Start campaign (nothing gets approved)")} icon="play" className={wide}
      confirmText={t("Dobara dabao: start karo (koi mail approve nahi hogi)", "Press again: start (nothing gets approved)")} pendingText={t("Start ho raha hai…", "Starting…")}
      next={reviewHref} nextCta={openApprove} />
  );

  const logo = (caption: string) => (
    <div className="border-t border-slate-100 px-3 py-2.5">
      <div className="mb-1.5 text-2xs text-slate-400">{caption}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`data:image/png;base64,${LOGO_PNG_BASE64}`} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt={t("Signature mein dikhne wala logo", "Logo shown in the signature")} className="h-auto max-w-full rounded border border-slate-200" />
    </div>
  );

  const mailsTitle = started ? t("Latest drafts aur bheji gayi mails", "Latest drafts and sent mails") : t("Sample drafts (sirf preview)", "Sample drafts (preview only)");
  const emptyText = started
    ? running
      ? p.toCreate > 0
        ? t("Worker har minute drafts banata hai (template wali 50 tak, AI wali 3 tak). Kuch der baad ye page dobara kholo.", "The worker makes drafts every minute (up to 50 template drafts, 3 AI drafts). Open this page again in a bit.")
        : t("Is campaign mein abhi koi draft nahi hai.", "This campaign has no draft right now.")
      : paused ? t("Campaign ruka hua hai, isliye nayi drafts nahi ban rahi. ‘Resume karo’ dabane ke baad worker drafts banayega.", "The campaign is paused, so no new drafts are being made. After you press ‘Resume’, the worker makes drafts.")
        : t("Is campaign se koi mail nahi bani.", "No mail was made from this campaign.")
    : canStart ? t("Chaho to upar Controls mein ‘5 sample drafts banao’ dabao (sirf preview), ya seedha campaign start karo.", "If you like, press ‘Make 5 sample drafts’ in Controls above (only a preview), or start the campaign right away.")
      : counts.needs_review > 0 ? t("Abhi koi Ready lead nahi hai. Pehle ‘Review chahiye’ wale leads Contacts mein approve karo, phir yahan samples banao.", "There is no Ready lead right now. First approve the ‘Needs review’ leads in Contacts, then make the samples here.")
        : t("Is campaign mein koi Ready lead nahi hai, isliye samples nahi ban sakte.", "This campaign has no Ready lead, so no samples can be made.");
  const previewNote = t(
    "Ye sirf preview hai: start karne se bhi ye approve nahi hoti, inhe bhi Approve page pe aap khud approve karoge.",
    "They are only a preview: starting does not approve them either; you approve them yourself on the Approve page too.",
  );
  const mailsInfo = (started
    ? t(
      "Is campaign ki aakhri 30 mails: jo aapke text ya approval ka wait kar rahi hain, jo approve hoke queue mein hain, aur jo ja chuki hain. Bheji gayi mail mein wahi text hai jo bhejte waqt save hua, yaani bilkul jo lead ko gaya. Na gayi mails aaj ki signature aur footer ke saath dikhti hain, jaise jayengi. Approve aur text edit Approve page pe hote hain.",
      "The last 30 mails of this campaign: the ones waiting for your text or approval, the approved ones in the queue and the ones already sent. A sent mail shows the text saved at sending time, exactly what the lead got. Unsent mails show with today's signature and footer, the way they will go out. Approving and editing happen on the Approve page.",
    )
    : plan.kind === "one"
      ? t(
        `Ye mails ${tplNo(plan.id)} se bani hain, AI se nahi: list ke pehle 5 leads ki details placeholders mein bhari gayi hain. ${previewNote} Har mail waise hi dikh rahi hai jaise lead ko jayegi (signature aur footer ke saath). Text badalna ho to Settings → Email templates mein template badlo, phir mail par ‘Template se dobara banao’ dabao.`,
        `These mails were made from ${tplNo(plan.id)}, not by the AI: the details of the first 5 leads of the list are filled into its placeholders. ${previewNote} Each mail shows exactly as the lead will get it (with signature and footer). To change the text, edit the template in Settings → Email templates, then press ‘Rebuild from template’ on the mail.`,
      )
      : bySite
        ? t(
          `Ye mails templates se bani hain, AI se nahi: list ke pehle 5 leads mein se har lead ko uski website ke group ka template mila (group mein kai hon to baari-baari se) aur uski details placeholders mein bhari gayi hain. ${previewNote} Har mail waise hi dikh rahi hai jaise lead ko jayegi (signature aur footer ke saath). Text badalna ho to Settings → Email templates mein template badlo, phir mail par ‘Template se dobara banao’ dabao.`,
          `These mails were made from templates, not by the AI: each of the first 5 leads of the list got a template of its website group (in turn when the group has several), with its details filled into the placeholders. ${previewNote} Each mail shows exactly as the lead will get it (with signature and footer). To change the text, edit the template in Settings → Email templates, then press ‘Rebuild from template’ on the mail.`,
        )
        : t(
          `AI ne list ke pehle 5 leads ke liye ye mails likhi hain. ${previewNote} Har mail waise hi dikh rahi hai jaise lead ko jayegi (signature aur footer ke saath). Koi mail pasand na aaye to ‘Naya version likho’ dabao.`,
          `The AI wrote these mails for the first 5 leads of the list. ${previewNote} Each mail shows exactly as the lead will get it (with signature and footer). If you don't like a mail, press ‘Write a new version’.`,
        ))
    + (isTpl
      ? bySite
        ? t(
          `\nHar mail par likha hai ki wo kis template se bani, aur lead ‘${siteGroup(false, t)}’ hai ya ‘${siteGroup(true, t)}’ (address ke neeche wajah bhi).`,
          `\nEach mail shows which template it was made from, and whether the lead is ‘${siteGroup(false, t)}’ or ‘${siteGroup(true, t)}’ (with the reason below the address).`,
        )
        : t("\nHar mail par likha hai ki wo kis template se bani.", "\nEach mail shows which template it was made from.")
      : "")
    + t(
      `\nJis lead ki CSV mein apna subject + body tha, uski mail par ‘Apna text (CSV)’ likha hai. ‘Text chahiye’ wali mail pe wajah likhi hai: ${OBS} ki jagah aapko apna text likhna hai, ya text mail ka koi rule tod raha hai (Approve page → ‘Text edit karo’); tab tak wo approve nahi ho sakti.`,
      `\nA mail made from the lead's own subject + body in the CSV says ‘Own text (CSV)’. A ‘Needs your text’ mail says why: you write your own words in place of ${OBS}, or the text breaks a mail rule (Approve page → ‘Edit text’); until then it cannot be approved.`,
    )
    + t(
      "\nLeft mein har mail bilkul waise hai jaise lead ko jaati hai, uski apni bhasha mein. Right mein hamesha usi mail ka English matlab hai: har mail ka apna alag translation, uske final text se bana (edit ke baad bhi). Ye sirf aapke check ke liye hai, lead ko nahi jaata. Jo mail English mein hi hai, uske right mein yahi likha aata hai.",
      "\nOn the left, every mail shows exactly as the lead gets it, in its own language. On the right is always the meaning of that same mail in English: a separate translation for every mail, made from its final text (also after an edit). It is only for you to check; the lead never gets it. When a mail is already in English, the right side says so.",
    );

  // small chips on a mail card and a failed draft: the template it was made from (or the lead's own text), and the lead's website group
  const tplChip = (x: TemplateId) => (
    <span key={x} className="badge min-w-0 max-w-full bg-violet-50 text-violet-700 ring-violet-600/15">
      <Icon name="file" size={11} className="shrink-0" /><span className="truncate">{templateLabel(s, x)}</span>
    </span>
  );
  const ownChip = (
    <span className="badge bg-teal-50 text-teal-700 ring-teal-600/15">
      <Icon name="pencil" size={11} className="shrink-0" />{t("Apna text (CSV)", "Own text (CSV)")}
    </span>
  );
  const groupChip = (has: boolean) => (
    <span className={`badge ${has ? "bg-sky-50 text-sky-700 ring-sky-600/15" : "bg-slate-100 text-slate-600 ring-slate-500/10"}`}>
      <Icon name="globe" size={11} className="shrink-0" />{siteGroup(has, t)}
    </span>
  );
  // "by website": the group a failed draft's lead is in and that group's templates (its lead was read above)
  const failPick = (leadId: string) => {
    const l = leadOf.get(leadId);
    return bySite && l && !l.own ? templatesForLead(c, l.website) : null;
  };

  const manualCta = t("Manual check karo", "Check manually");

  // the pipeline: every lead of the campaign, from "draft still to make" to "sent" (counts only)
  const pipe: PipeItem[] = [
    {
      label: t("Drafts banne baaki", "Drafts still to make"), value: p.toCreate, tone: "sky",
      info: started
        ? t(
          "Ready leads jinki draft abhi nahi bani. Worker har minute banata hai: template wali 50 tak, AI wali 3 tak (AI ki free limit ke hisaab se). Campaign ruka ho to nahi banti. Koi bhi draft apne aap approve nahi hoti.",
          "Ready leads that have no draft yet. The worker makes them every minute: up to 50 template drafts, 3 AI drafts (within the AI's free limits). Not while the campaign is paused. No draft is ever approved by itself.",
        )
        : t(
          "Ready leads jinki draft abhi nahi bani. Start ke baad worker sabki draft banayega; sample drafts isme nahi gine jaate.",
          "Ready leads that have no draft yet. After the start the worker makes a draft for all of them; sample drafts are not counted here.",
        ),
    },
    {
      label: t("Text chahiye", "Needs your text"), value: p.needsText, tone: "amber", href: textHref,
      info: t(
        `Drafts jinme pehle aapka text chahiye: template mein {{observation}} hai par lead ki CSV mein observation nahi thi (text mein ${OBS} likha hai), ya bhara hua template / lead ka apna CSV text mail ka koi rule tod raha hai${isTpl ? "" : ", ya AI 5 koshish mein draft nahi likh paya"}. Approve page pe ‘Text edit karo’ se theek karo aur save karo. Tab tak ye approve nahi ho sakti.`,
        `Drafts that first need your text: the template uses {{observation}} while the lead's CSV row had none (the text says ${OBS}), or the filled template / the lead's own CSV text breaks a mail rule${isTpl ? "" : ", or the AI could not write the draft in 5 tries"}. Fix them with ‘Edit text’ on the Approve page and save. Until then they cannot be approved.`,
      ),
    },
    {
      label: t("Approval baaki", "Awaiting approval"), value: p.waiting, tone: "indigo", href: reviewHref,
      info: t(
        "Taiyaar drafts jo aapke approve ka wait kar rahi hain. Aapke apne click (Approve page pe) ke bina koi mail nahi jaati.",
        "Finished drafts waiting for your approval. No mail goes out without your own click on the Approve page.",
      ),
    },
    {
      label: t("Approved: queue mein", "Approved: in the queue"), value: p.queued, tone: "violet",
      info: t(
        "Aapki approve ki hui mails jo abhi jaani baaki hain (retry wali bhi). Worker inhe sending window aur din, random gap, warm-up daily limit aur plan ki 40% limit ke andar apne aap bhejta hai; Ledger, Block List aur auto-pause ka dhyan rakhta hai."
        + (s.dryRun ? " DRY-RUN mein sirf wo gini jaati hain jo abhi test address pe nahi gayi." : ""),
        "Mails you approved that have not gone out yet (retries included). The worker sends them by itself within the sending window and days, a random gap, the warm-up daily limit and the 40% plan cap, and respects the Ledger, the Block List and auto-pause."
        + (s.dryRun ? " In DRY-RUN only the ones not yet sent to your test address count." : ""),
      ),
    },
    // DRY-RUN: approved mails already sent to the test address are out of the queue until LIVE
    ...(s.dryRun ? [{
      label: t("Test address pe gayi", "Sent to the test address"), value: dryDone, tone: "teal" as const,
      sub: t("LIVE ke baad leads ko jayengi", "Go to the leads after LIVE"),
      info: t(
        "Approve ki hui mails jo DRY-RUN mein aapke test address pe ja chuki hain. Leads ko ye abhi nahi gayi aur worker inhe abhi dobara nahi bhejta: LIVE ke baad leads ko jayengi (dobara approve nahi karna).",
        "Approved mails that went to your test address in DRY-RUN. The leads have not got them and the worker does not send them again now: they go to the leads after LIVE (no need to approve again).",
      ),
    }] : []),
    {
      label: t("Bheji gayi", "Sent"), value: p.sent, tone: "emerald",
      info: t("Leads jinhe is campaign se mail ja chuki hai (reply, bounce aur opt-out wale bhi).", "Leads this campaign has mailed (including the ones that replied, bounced or opted out)."),
    },
    {
      label: t("Fail", "Failed"), value: p.failed, tone: "red",
      info: t(
        "Mails jo nahi ja payi, ya jinka status pakka nahi (manual check). Manual check wali mails apne aap dobara kabhi nahi jaati.",
        "Mails that could not be sent, or whose status is uncertain (manual check). Mails needing a manual check are never resent automatically.",
      ),
    },
    {
      label: t("Skip", "Skipped"), value: p.skipped, tone: "slate",
      info: t(
        "Leads jinhe is campaign se mail nahi jayegi: pehle contact ho chuke (Ledger), Block List mein hain, ya aapne reject kiye.",
        "Leads this campaign will not mail: already contacted (Ledger), on the Block List, or rejected by you.",
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={c.name}
        back={{ href: "/campaigns", label: "Campaigns" }}
        info={t(
          "Is campaign ka control page. Upar ke steps batate hain ki aap kahan ho:\n1. Samples (optional): 5 drafts ka preview, approve nahi hote.\n2. Start: koi mail approve nahi hoti.\n3. Worker har Ready lead ki draft banata hai.\n4. Aap Approve page pe har mail khud approve karte ho: ye aakhri step hai.\n5. Approve hui mails apne aap limits ke andar jaati hain.",
          "The control page of this campaign. The steps at the top show where you are:\n1. Samples (optional): a preview of 5 drafts, not approved.\n2. Start: no mail gets approved.\n3. The worker makes a draft for every Ready lead.\n4. You approve every mail yourself on the Approve page: this is the last step.\n5. Approved mails go out by themselves within the limits.",
        )}
        sub={
          <span className="flex flex-col gap-1.5">
            <span className="inline-flex flex-wrap items-center gap-2">
              <Badge v={c.status} />
              {s.dryRun && <Badge v="dry-run" label="DRY-RUN" />}
              <span>{c.language.toUpperCase()} · {list?.name || t("List nahi mili", "List not found")}</span>
              <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                {/* the "by website" label is long: it may wrap inside the chip on phones */}
                <span className={`badge h-auto min-h-5 min-w-0 max-w-full whitespace-normal py-0.5 leading-tight ${isTpl ? "bg-violet-50 text-violet-700 ring-violet-600/15" : "bg-indigo-50 text-indigo-700 ring-indigo-600/15"}`}>
                  <Icon name={isTpl ? "file" : "bot"} size={11} className="shrink-0" /><span className="min-w-0 break-words">{mailType}</span>
                </span>
                <Info title={t("Mail kaise banti hai", "How mails are written")} text={mailTypeInfo} size={13} />
              </span>
            </span>
            {/* "by website": which templates the campaign's leads get (counted when the campaign was created) */}
            {split && bySite && (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="font-medium text-slate-600">{t("Campaign ke leads (banate waqt):", "Campaign leads (at creation):")}</span>
                <span className="whitespace-nowrap">{t(`${split.nosite} bina website → ${short(bySite.nosite)}`, `${split.nosite} without a website → ${short(bySite.nosite)}`)}</span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="whitespace-nowrap">{t(`${split.site} website wale → ${short(bySite.site)}`, `${split.site} with a website → ${short(bySite.site)}`)}</span>
              </span>
            )}
          </span>
        }
      />

      <div className="hidden md:block"><Steps steps={steps} /></div>
      <PhoneSteps steps={steps} focus={phoneStep} />

      <NextStep {...next} />

      {stuck > 0 && (
        <Callout tone="warn" title={t(`${stuck} ${stuck === 1 ? "lead" : "leads"} is campaign se nahi jayenge`, `${plural(stuck, "lead", "leads")} will not get a mail from this campaign`)}>
          {t(
            "Campaign poora ho chuka hai. Isme bache ‘Review chahiye’ ya baad mein approve hue leads ko ab is campaign se mail nahi jayegi, approve karne par bhi nahi.",
            "The campaign is finished. Leads left in it with ‘Needs review’, or approved later, will no longer get a mail from this campaign, not even if you approve them.",
          )}
        </Callout>
      )}

      {showFailing && (
        <>
          <Callout tone="warn" title={started ? t("Kuch drafts retry ke liye ruke hain", "Some drafts are waiting for a retry") : t("Kuch sample drafts nahi ban paye", "Some sample drafts could not be made")}
            action={isTpl && !partial ? fixTemplate : undefined}>
            <p>{failText}</p>
            <ul className="mt-2.5 space-y-1.5">
              {failing.map((f) => {
                const pick = failPick(f.id);
                const own = leadOf.get(f.id)?.own;
                return (
                  <li key={f.id} className="min-w-0 rounded-lg bg-white/70 px-3 py-2 text-xs ring-1 ring-inset ring-amber-200/70">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      {/* the id is the lead's email key: only "/" is escaped in it (never decodeURIComponent: a "%" in an address would crash the page) */}
                      <span className="break-all font-semibold">{f.id.replace(/%2F/g, "/")}</span>
                      <span>{t("Koshish", "Attempts")}: {f.attempts ?? "—"}</span>
                      {running && <span>{t("Agli koshish", "Next try")}: {fmt(f.nextTryAt)}</span>}
                    </div>
                    {pick && (
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                        {pick.group && groupChip(pick.group === "site")}
                        {pick.ids.length > 1 && <span className="text-2xs text-amber-900/70">{t("in mein se ek:", "one of:")}</span>}
                        {pick.ids.map(tplChip)}
                      </div>
                    )}
                    {own && (
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                        {ownChip}
                        <span className="min-w-0 break-words text-2xs">
                          {t(
                            "Is lead ka apna text (CSV) mail ke rules pass nahi karta: template theek karne se ye draft nahi banegi.",
                            "This lead's own text (CSV) does not pass the mail rules: fixing a template will not make this draft.",
                          )}
                        </span>
                      </div>
                    )}
                    {f.lastError && <div className="mt-1 break-words font-mono text-2xs leading-relaxed">{f.lastError}</div>}
                  </li>
                );
              })}
            </ul>
          </Callout>
          <ToastOnMount kind="warning" title={failToast.title} text={failToast.text} once={`drafts:${id}:${failing.length}`} />
        </>
      )}

      {counts.check_manual > 0 && (
        <>
          <Callout tone="danger" title={t(`${counts.check_manual} mail ka status pakka nahi hai`, `${plural(counts.check_manual, "mail has", "mails have")} an uncertain status`)}
            action={<Link href="/contacts?status=check_manual" className="btn btn-sm w-full sm:w-auto">{manualCta}<Icon name="arrow-right" size={13} /></Link>}>
            {t(
              "SMTP server ne saaf jawab nahi diya, isliye pata nahi mail gayi ya nahi. Har contact kholo, mailbox ka Sent folder dekho aur ‘Haan, mail gayi thi’ ya ‘Nahi gayi’ dabao. Ye mails apne aap dobara kabhi nahi jaati.",
              "The SMTP server gave no clear answer, so it is unknown whether the mail went out. Open each contact, check the mailbox's Sent folder and press ‘Yes, it was sent’ or ‘No, not sent’. These mails are never resent automatically.",
            )}
          </Callout>
          <ToastOnMount kind="error" title={t("Kuch mails manual check maang rahi hain", "Some mails need a manual check")}
            text={t(
              `${counts.check_manual} mail ka status pakka nahi hai. Har contact kholo, Sent folder dekho aur mark karo.`,
              `${plural(counts.check_manual, "mail has", "mails have")} an uncertain status. Open each contact, check the Sent folder and mark it.`,
            )}
            href="/contacts?status=check_manual" cta={manualCta} once={`manual:${id}:${counts.check_manual}`} />
        </>
      )}

      {showControls && <Section id="controls" title="Controls" icon="sliders"
        info={t(
          `Campaign yahan se chalao.\n1. Optional: ‘5 sample drafts banao’: ${sampleHow}. Ye sirf preview hain, kabhi apne aap approve nahi hote.\n2. ‘Campaign start karo’ do baar dabao (galti se na ho, isliye). Kam se kam 1 Ready lead chahiye. Start se koi mail approve nahi hoti.\n3. Start ke baad worker har Ready lead ki draft banata hai: har minute template wali 50 tak, AI wali 3 tak. Sab ‘Approval baaki’ rehti hain.\n4. Approve page pe padho aur approve karo: ye aakhri step hai, sirf aapka apna click approve karta hai.\n5. Approve hui mail apne aap jaati hai: sending window aur din, random gap aur warm-up daily limit ke andar.\nChalte campaign ko kabhi bhi Pause kar sakte ho; Resume se wahin se aage chalega.`,
          `Run the campaign from here.\n1. Optional: ‘Make 5 sample drafts’: ${sampleHow}. They are only a preview and are never approved by themselves.\n2. Press ‘Start campaign’ twice (so it never happens by mistake). It needs at least 1 Ready lead. Starting approves no mail.\n3. After the start the worker makes a draft for every Ready lead: up to 50 template drafts and 3 AI drafts a minute. All of them wait as ‘Awaiting approval’.\n4. Read and approve them on the Approve page: this is the last step, and only your own click approves.\n5. An approved mail goes out by itself: within the sending window and days, a random gap and the warm-up daily limit.\nYou can pause a running campaign at any time; Resume carries on from where it stopped.`,
        )}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {statusLine && <p className="min-w-0 text-sm text-slate-600">{statusLine}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:shrink-0">
            {canStart && <>
              <ActionButton action={samplesAction.bind(null, id)} label={t("5 sample drafts banao (optional)", "Make 5 sample drafts (optional)")} icon={isTpl ? "file" : "bot"} pendingText={writing} className={`${!messages.length || partial ? "btn-primary" : "btn"} ${WIDE}`} />
              {startButton(`${messages.length && !partial ? "btn-primary" : "btn"} ${WIDE}`)}
            </>}
            {running && <ActionButton action={pauseCampaign.bind(null, id)} label={t("Pause karo", "Pause")} icon="pause" className={`btn ${WIDE}`} />}
            {paused && <ActionButton action={resumeCampaign.bind(null, id)} label={t("Resume karo", "Resume")} icon="play" className={`btn-primary ${WIDE}`} next={reviewHref} nextCta={openApprove} />}
            {counts.check_manual > 0 && (
              <Link className={`btn ${WIDE} text-red-700 hover:text-red-800`} href="/contacts?status=check_manual">
                <Icon name="alert" size={14} />{t(`${counts.check_manual} mail manual check karo`, `Check ${plural(counts.check_manual, "mail", "mails")} manually`)}
              </Link>
            )}
          </div>
        </div>
        {counts.already_contacted > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <Badge v="already_contacted" label={t(`${counts.already_contacted} leads skip hue`, `${plural(counts.already_contacted, "lead", "leads")} skipped`)} />
            <span>{t("Ye pehle contact ho chuke the", "They were contacted before")}</span>
            <Info title={t("Pehle contact hue leads", "Already contacted leads")} size={13}
              text={t(
                "Ye leads Contacted Ledger mein pehle se the, yaani inhe kabhi na kabhi mail ja chuki hai. Inhe dobara cold mail kabhi nahi jayegi.",
                "These leads were already in the Contacted ledger, so they were emailed at some point. They will never get a cold mail again.",
              )} />
          </div>
        )}
      </Section>}

      <Section id="pipeline" title={t("Pipeline", "Pipeline")} icon="activity"
        sub={t("Draft → (Text chahiye) → Approval baaki → Approved: queue mein → Bheji gayi", "Draft → (Needs your text) → Awaiting approval → Approved: in the queue → Sent")}
        info={t(
          "Is campaign ke leads aur drafts kis step pe hain. Har step ki ginti har baar page kholne pe taaza hoti hai. Jin boxes pe teer (›) hai, unhe dabake Approve page pe sirf wahi drafts khulti hain.",
          "Which step this campaign's leads and drafts are at. The counts are fresh every time you open the page. A box with an arrow (›) opens just those drafts on the Approve page.",
        )}>
        {/* DRY-RUN adds the "sent to the test address" step: 8 tiles, two full rows of 4 on tablets */}
        <div className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${pipe.length > 7 ? "xl:grid-cols-8" : "xl:grid-cols-7"}`}>
          {pipe.map((x) => <PipeTile key={x.label} {...x} />)}
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("Baaki", "Remaining")} value={remaining} icon="clock" tone="sky"
          info={done
            ? t(
              "Campaign poora ho chuka hai, isliye is campaign se ab koi mail nahi jayegi: na Ready leads ko, na ‘Review chahiye’ wale leads ko (approve karne par bhi nahi).",
              "The campaign is finished, so it will not send any more mail: not to Ready leads and not to ‘Needs review’ leads (not even if you approve them).",
            )
            : t(
              "Is campaign mein kitne leads ko abhi mail jaani baaki hai (status Ready): draft bani ho ya nahi, approve hui ho ya nahi. Pipeline mein dikhta hai ki ye kis step pe hain. ‘Review chahiye’ wale leads ko pehle Contacts page pe approve karna hoga. Unhe Ready leads khatam hone se pehle approve karo, warna campaign khatam ho jayega aur wo reh jayenge.",
              "How many leads in this campaign still have to get a mail (status Ready), with or without a draft, approved or not. The Pipeline shows which step they are at. ‘Needs review’ leads must first be approved on the Contacts page. Approve them before the Ready leads run out, otherwise the campaign ends and they are left out.",
            )}
          sub={counts.needs_review > 0 && !done
            ? <Link href="/contacts?status=needs_review" className="link">{t("Review chahiye", "Needs review")}: {counts.needs_review}</Link>
            : `${t("Review chahiye", "Needs review")}: ${counts.needs_review}`} />
        <Stat label={t("Bheji gayi", "Sent")} value={p.sent} icon="send" tone="emerald"
          info={t(
            "Is campaign se kitni mails ja chuki hain. Neeche likha hai kitno ne reply kiya, kitni bounce hui aur kitno ne opt-out kiya.",
            "How many mails this campaign has sent. Below it: how many leads replied, how many mails bounced and how many leads opted out.",
          )}
          sub={<Parts items={[t(`Reply ${counts.replied}`, `Replies ${counts.replied}`), t(`Bounce ${counts.bounced}`, `Bounces ${counts.bounced}`), t(`Opt-out ${counts.opted_out}`, `Opt-outs ${counts.opted_out}`)]} />} />
        <Stat label={t("Approved queue kab tak", "Approved queue sent by")} icon="calendar" tone="indigo"
          value={done ? t("Poora ho gaya", "Finished")
            : <span className="text-lg sm:text-2xl">{!started ? t("Start ke baad", "Once started") : paused ? t("Ruka hua", "Paused") : !p.queued ? t("Queue khaali", "Queue empty") : fmtDate(est)}</span>}
          info={t(
            `Andaza ki aapki approve ki hui mails (abhi ${p.queued} queue mein) kab tak chali jayengi; date sirf chalte campaign ki. Sirf approved mails gini jaati hain: jo draft abhi approve nahi hui, wo isme nahi, isliye jitni aur approve karoge, date utni aage jayegi. Aaj ki daily limit, warm-up (limit roz thodi badhti hai), plan ki 40% limit, random gap aur sending window/din se nikala gaya hai. Pehle bane chalte campaigns ki approved mails pehle jaati hain, wo bhi gini gayi hain.`
            + (s.dryRun ? ` DRY-RUN mein sirf test address pe jaani baaki mails gini jaati hain; jo ${dryDone} wahan ja chuki hain, wo LIVE ke baad leads ko jayengi.` : ""),
            `An estimate of when the mails you approved (${p.queued} in the queue now) will have gone out; the date shows only for a running campaign. Only approved mails count: drafts not approved yet are not in it, so every mail you approve moves the date later. It is worked out from today's daily limit, the warm-up (the limit grows a little each day), the 40% plan cap, the random gap and the sending window and days. Approved mails of older running campaigns go first and are counted too.`
            + (s.dryRun ? ` In DRY-RUN only the mails still to go to your test address count; the ${dryDone} already sent there go to the leads after LIVE.` : ""),
          )}
          sub={<Parts items={[t(`Aaj ki limit ${cap}/din`, `Today's limit ${cap}/day`), `${s.windowStart}-${s.windowEnd}`, c.timezone]} />} />
        <Stat label={t("Bhasha / List", "Language / List")} value={c.language.toUpperCase()} icon="globe" tone="violet"
          info={t(
            "Mails is bhasha mein likhi jaati hain. List wahi hai jisse campaign bana. ‘Kahan se mile’ mail ke footer mein likha jaata hai (address kahan se mila).",
            "Mails are written in this language. The list is the one the campaign was created from. ‘Source’ is written in the mail footer (where the address was found).",
          )}
          sub={<span className="break-words">{list?.name || "—"} · {t("Kahan se mile", "Source")}: {list?.sourceNote || NO_SOURCE}</span>} />
      </div>

      <section id="mails" className="scroll-mt-20 space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-200/60 text-slate-500"><Icon name="mail" size={15} /></span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <h2 className="h2">{mailsTitle}</h2>
            <Info title={mailsTitle} text={mailsInfo} />
          </div>
          {messages.length > 0 && <span className="badge shrink-0">{t(`${messages.length} mail`, plural(messages.length, "mail", "mails"))}</span>}
        </div>

        {messages.map((m) => {
          const needsText = m.status === "needs_text";
          // a mail that went out (or may have) shows the text saved at sending time; the rest are built from today's settings
          const stored = !!m.sentText;
          const label = stored
            ? (m.status === "sent" || m.status === "bounced" ? t("Mail jo gayi", "Mail as sent") : t("Mail jo bhejne ki koshish hui", "Mail we tried to send"))
            : needsText ? t("Draft (aapka text baaki)", "Draft (your text is missing)")
              : UNSENT.includes(m.status) ? t("Mail (jaisi jayegi)", "Mail (as it will go out)") : t("Mail (footer aaj ki settings se)", "Mail (footer from today's settings)");
          const text = m.sentText || fullText(s, m.body, m.language, list?.sourceNote || NO_SOURCE);
          const footer = stored
            ? m.sentWithLogo ? logo(t("Logo (is mail mein signature ke neeche tha)", "Logo (was below the signature in this mail)")) : undefined
            : s.signatureLogo ? logo(t("Logo (HTML mail mein signature ke neeche)", "Logo (below the signature in the HTML mail)")) : undefined;
          const tid = tplOfMail(m);
          // "by website": the lead's group and why (its lead was read above); the lead's own text has no group
          const lead = bySite && !m.custom ? leadOf.get(m.leadId || m.id) : undefined;
          const site = lead ? siteStatus(lead.website) : null;
          // the right side: this mail's own English translation, made from its final text
          const en = englishOf(m);
          // an unsent draft can always be translated again; any other mail only when its translation is missing.
          // A draft still waiting for my text gets its English once I save that text.
          const canTranslate = m.status === "ready" || (en.kind === "pending" && m.status !== "rejected" && !needsText);
          // why a "Text chahiye" draft waits for me: details the lead lacks ([OBSERVATION]) and / or the draft rules its text
          // breaks. A draft stored before these fields existed has neither: then it is the missing observation.
          const problems = needsText ? m.problems || [] : [];
          const missing = !needsText ? [] : m.missing?.length ? m.missing : problems.length ? [] : ["observation"];
          const marks = missing.map(missingMark).join(", ");
          const keys = missing.map((k) => `{{${k}}}`).join(", ");
          // an AI campaign's own draft (not the lead's CSV text) only waits for me after the AI failed 5 times
          const aiFailed = needsText && !m.custom && plan.kind === "ai";
          // approved and already sent to the test address in DRY-RUN: out of the queue until LIVE
          const inQueue = (m.status === "ready" || m.status === "retry") && !!m.approved;
          const atTest = s.dryRun && inQueue && m.dryRunDone;
          return (
            <article key={m.id} className="card space-y-4">
              <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge v={m.status} />
                    {m.status === "ready" && !m.approved && <Badge v="approval" label={t("Approval baaki", "Awaiting approval")} tone="amber" dot={false} />}
                    {inQueue && !atTest && <Badge v="approved" label={t("Approved: queue mein", "Approved: in the queue")} tone="emerald" dot={false} />}
                    {atTest
                      ? <Badge v="dry-run" label={t("Test address pe gayi", "Sent to the test address")} tone="sky" dot={false} />
                      : m.dryRunDone && <Badge v="dry-run" label={t("Dry-run mein gayi", "Sent in dry-run")} dot={false} />}
                    {m.businessName && <span className="min-w-0 break-words font-semibold text-slate-900">{m.businessName}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    <span className="break-all">{m.leadEmail}</span>
                    {atTest && <span className="inline-flex items-center gap-1"><Icon name="clock" size={12} />{t("LIVE ke baad lead ko jayegi", "Goes to the lead after LIVE")}</span>}
                    {m.sentAt && <span className="inline-flex items-center gap-1"><Icon name="send" size={12} />{t("Bheji", "Sent")}: {fmt(m.sentAt)}</span>}
                    {m.status === "retry" && m.nextAttemptAt && <span className="inline-flex items-center gap-1"><Icon name="clock" size={12} />{t("Agli koshish", "Next try")}: {fmt(m.nextAttemptAt)}</span>}
                  </div>
                  {(tid || m.custom || site) && (
                    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                      {tid && tplChip(tid)}
                      {m.custom && ownChip}
                      {site && groupChip(site.has)}
                      {site && <span className="min-w-0 break-words text-2xs text-slate-500">{siteText(site, t)}</span>}
                    </div>
                  )}
                </div>
                {(m.status === "ready" || needsText) && !m.custom && (
                  <ActionButton action={regenerateDraft.bind(null, m.id)} label={tid || isTpl ? t("Template se dobara banao", "Rebuild from template") : t("Naya version likho", "Write a new version")} icon="refresh" className="btn btn-sm" pendingText={writing}
                    next={started ? reviewHref : undefined} nextCta={started ? openApprove : undefined} />
                )}
              </header>
              {needsText && (
                <Callout tone="warn" title={aiFailed ? t("AI ye mail nahi likh paya", "The AI could not write this mail") : t("Is mail mein aapka text chahiye", "This mail needs your text")}
                  action={<Link href={textHref} className="btn btn-sm w-full sm:w-auto"><Icon name="pencil" size={13} />{writeText}</Link>}>
                  {missing.length > 0 && (
                    <p>{t(
                      `${m.custom ? "Lead ke apne text (CSV)" : "Template"} mein ${keys} hai, par is lead ki CSV mein ye nahi tha, isliye text mein ${marks} likha hai: wahan apne shabdon mein likho (jaise unki website ki ek asli problem jo aapne dekhi).`,
                      `${m.custom ? "The lead's own text (CSV)" : "The template"} uses ${keys}, but this lead's CSV row had none, so the text says ${marks}: write your own words there (like one real problem you saw on their website).`,
                    )}</p>
                  )}
                  {problems.length > 0 && (
                    <div className={missing.length ? "mt-1.5" : ""}>
                      <p>{aiFailed
                        ? t("5 koshish ke baad bhi AI sahi draft nahi likh paya. Aakhri wajah:", "After 5 tries the AI still could not write a valid draft. The last reason:")
                        : m.custom
                          ? t("Lead ka apna text (CSV) mail ke rules pass nahi karta:", "The lead's own text (CSV) does not pass the mail rules:")
                          : t("Bhara hua template mail ke rules pass nahi karta:", "The filled template does not pass the mail rules:")}</p>
                      <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                        {problems.map((e, i) => <li key={i} className="break-words">{ruleLine(e)}</li>)}
                      </ul>
                    </div>
                  )}
                  <p className="mt-1.5">{aiFailed
                    ? t(
                      "Approve page pe ‘Text edit karo’ se mail khud likho, ya upar ‘Naya version likho’ dabao. Tab tak ye mail approve nahi ho sakti.",
                      "Write the mail yourself with ‘Edit text’ on the Approve page, or press ‘Write a new version’ above. Until then this mail cannot be approved.",
                    )
                    : t(
                      "Approve page pe ‘Text edit karo’ se theek karo aur save karo. Tab tak ye mail approve nahi ho sakti.",
                      "Fix it with ‘Edit text’ on the Approve page and save. Until then this mail cannot be approved.",
                    )}</p>
                </Callout>
              )}
              {/* left: the mail exactly as the lead gets it; right: always its meaning in English, only for me */}
              <div className="grid gap-4 md:grid-cols-2">
                <MailPreview label={label} subject={m.subject} text={text} footer={footer} />
                {needsText && en.kind === "pending"
                  ? (
                    <div className="min-w-0">
                      <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400"><Icon name="globe" size={12} />{t("English translation", "English translation")}</div>
                      <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs leading-relaxed text-slate-500">
                        <Icon name="pencil" size={16} className="mx-auto mb-1.5 text-slate-400" />
                        {t(
                          "English translation tab banega jab aap apna text likh ke save karoge (Approve page → ‘Text edit karo’).",
                          "The English translation is made once you write your text and save it (Approve page → ‘Edit text’).",
                        )}
                      </div>
                    </div>
                  )
                  : <EnglishMail en={en} text={en.kind === "ready" ? fullText(s, en.body, "en", list?.sourceNote || NO_SOURCE) : undefined}
                    action={canTranslate ? translateMessage.bind(null, m.id) : undefined} />}
              </div>
              {m.smtpResponse && (
                <p className="break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
                  <span className="font-sans font-medium text-slate-400">{t("SMTP jawab", "SMTP response")}: </span>{m.smtpResponse}
                </p>
              )}
              {m.error && (
                <p className="flex items-start gap-1.5 text-xs text-red-600">
                  <Icon name="x-circle" size={13} className="mt-0.5" /><span className="min-w-0 break-words">{m.error}</span>
                </p>
              )}
            </article>
          );
        })}

        {!messages.length && (
          <div className="card-flush">
            <EmptyState icon={isTpl ? "file" : "bot"} title={t("Abhi koi draft nahi", "No drafts yet")} text={emptyText} />
          </div>
        )}

        {canStart && messages.length > 0 && !partial && (
          <NextStep title={t("Saare samples padh liye?", "Read all the samples?")} tone="emerald"
            text={isTpl
              ? t(
                `Theek lagein to campaign start karo: koi mail approve nahi hogi, har mail aap Approve page pe khud approve karoge. Text badalna ho to Settings → Email templates mein template badlo${manyTpls ? " (har mail par likha hai kaunsa)" : ""}, phir mail par ‘Template se dobara banao’ dabao.`,
                `If they look good, start the campaign: no mail gets approved; you approve every mail yourself on the Approve page. To change the text, edit the template in Settings → Email templates${manyTpls ? " (each mail shows which one)" : ""}, then press ‘Rebuild from template’ on the mail.`,
              )
              : t(
                "Theek lagein to campaign start karo: koi mail approve nahi hogi, har mail aap Approve page pe khud approve karoge. Koi mail pasand na aaye to us par ‘Naya version likho’ dabao.",
                "If they look good, start the campaign: no mail gets approved; you approve every mail yourself on the Approve page. If you don't like a mail, press ‘Write a new version’ on it.",
              )}>
            {startButton(`btn-primary ${WIDE}`)}
          </NextStep>
        )}
      </section>
    </div>
  );
}

type StepItem = { label: string; state: StepState; href?: string };

/**
 * Phones and small tablets: the step pills do not fit in one row, so show one step (focus) with a small bar of all steps.
 * Drafting, approving and sending run side by side, so the page picks the step to show.
 */
function PhoneSteps({ steps, focus }: { steps: StepItem[]; focus: number }) {
  const i = Math.min(Math.max(0, focus), steps.length - 1);
  const cur = steps[i];
  const label = <>{cur.label}{cur.href && <Icon name="chevron-right" size={14} className="text-slate-400" />}</>;
  return (
    <div className="md:hidden">
      <div className="mb-2 flex items-center justify-between gap-3">
        {cur.href
          ? <Link href={cur.href} className="inline-flex min-w-0 items-center gap-0.5 text-sm font-semibold text-slate-900">{label}</Link>
          : <span className="min-w-0 text-sm font-semibold text-slate-900">{label}</span>}
        <span className="shrink-0 text-xs font-medium text-slate-400">Step {i + 1} / {steps.length}</span>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-hidden="true">
        {steps.map((s, k) => <span key={k} className={`h-1.5 rounded-full ${s.state === "done" ? "bg-emerald-500" : s.state === "current" ? "bg-indigo-500" : "bg-slate-200"}`} />)}
      </div>
    </div>
  );
}

type PipeTone = "sky" | "amber" | "indigo" | "violet" | "teal" | "emerald" | "red" | "slate";
type PipeItem = { label: string; value: number; info: string; tone: PipeTone; href?: string; sub?: string };

// a step with something in it is coloured; an empty one stays plain
const PIPE_TONE: Record<PipeTone, { box: string; num: string }> = {
  sky: { box: "bg-sky-50/70 ring-sky-200", num: "text-sky-700" },
  amber: { box: "bg-amber-50/80 ring-amber-300", num: "text-amber-700" },
  indigo: { box: "bg-indigo-50/80 ring-indigo-300", num: "text-indigo-700" },
  violet: { box: "bg-violet-50/70 ring-violet-200", num: "text-violet-700" },
  teal: { box: "bg-teal-50/70 ring-teal-200", num: "text-teal-700" },
  emerald: { box: "bg-emerald-50/70 ring-emerald-200", num: "text-emerald-700" },
  red: { box: "bg-red-50/70 ring-red-200", num: "text-red-700" },
  slate: { box: "bg-slate-50 ring-slate-200", num: "text-slate-700" },
};

/** One step of the pipeline: its count, a short (i), an optional line under the count, and (when it has drafts to act on) a link to them. */
function PipeTile({ label, value, info, tone, href, sub }: PipeItem) {
  const on = value > 0;
  const link = href && on;
  const body = (
    <>
      <div className="flex items-start gap-1 text-xs font-medium text-slate-500">
        <span className="min-w-0 break-words leading-tight">{label}</span>
        <Info text={info} title={label} size={12} className="mt-px" />
        {link && <Icon name="chevron-right" size={13} className="ml-auto shrink-0 text-slate-400" />}
      </div>
      {/* mt-auto: the numbers of one row line up even when a label takes two lines */}
      <div className={`mt-auto pt-1.5 text-xl font-semibold tabular-nums tracking-tight ${on ? PIPE_TONE[tone].num : "text-slate-400"}`}>{value}</div>
      {sub && <div className="break-words text-2xs leading-tight text-slate-500">{sub}</div>}
    </>
  );
  const box = `flex min-w-0 flex-col rounded-lg px-3 py-2.5 ring-1 ring-inset ${on ? PIPE_TONE[tone].box : "bg-white ring-slate-200"}`;
  return link
    ? <Link href={href} className={`${box} transition hover:shadow-sm`}>{body}</Link>
    : <div className={box}>{body}</div>;
}

/** "a · b · c" where each part stays on one line (no break inside "Opt-out" or "09:30-17:30"). */
function Parts({ items }: { items: string[] }) {
  return <>{items.map((x, i) => <span key={i}>{i > 0 && " · "}<span className="whitespace-nowrap">{x}</span></span>)}</>;
}
