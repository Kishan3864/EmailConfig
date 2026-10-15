import Link from "next/link";
import type { ComponentProps } from "react";
import { notFound } from "next/navigation";
import { C, count, rows, type Campaign, type Message, type LeadList } from "@/lib/fsdb";
import { getSettings } from "@/lib/settings";
import { getT } from "@/lib/i18n-server";
import { estimateFinish, capFor, priorSendingDays } from "@/lib/schedule";
import { fullText } from "@/lib/compose";
import { LOGO_HEIGHT, LOGO_PNG_BASE64, LOGO_WIDTH } from "@/lib/logo";
import { fmt, fmtDate } from "@/lib/time";
import { Badge, Callout, EmptyState, MailPreview, NextStep, PageHeader, Section, Stat, Steps, type StepState } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { Info } from "@/components/Info";
import { Icon } from "@/components/icons";
import { ToastOnMount } from "@/components/toast";
import { samplesAction, startCampaign, pauseCampaign, resumeCampaign, regenerateDraft } from "../../actions";

const STATUSES = ["ready", "needs_review", "sent", "replied", "bounced", "opted_out", "check_manual", "already_contacted"];

// Control buttons: full width on phones, and long labels may wrap instead of overflowing.
const WIDE = "h-auto min-h-9 w-full whitespace-normal py-1.5 text-center sm:min-h-8 sm:w-auto";

// The footer source the sender uses when the list has no "Kahan se mile" note (same fallback as sender.ts).
const NO_SOURCE = "a public business directory";
// Message statuses that have not gone out yet: shown the way they will go.
const UNSENT = ["ready", "sending", "retry"];

/** A stored message. When it goes out, the sender saves the exact text (sentText) and whether the logo went with it. */
type Row = Message & { approved?: boolean; sentText?: string; sentWithLogo?: boolean };

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
  const list = (await C.lists.doc(c.listId).get()).data() as LeadList;
  const s = await getSettings();
  const counts: Record<string, number> = {};
  for (const st of STATUSES) counts[st] = await count(C.leads.where("campaignId", "==", id).where("status", "==", st));
  const remaining = counts.ready;
  const finish = c.status === "done" ? null : await estimateFinish(s, c.timezone, remaining);
  const cap = capFor(s, await priorSendingDays(c.timezone));
  const messages = rows<Row>(await C.messages.where("campaignId", "==", id).orderBy("createdAt", "desc").limit(c.samplesApproved ? 30 : 5).get());
  const failing = (await C.draftJobs.where("campaignId", "==", id).limit(10).get()).docs.map((d) => ({
    id: d.id, attempts: d.get("attempts") as number | undefined, nextTryAt: d.get("nextTryAt") as string | undefined, lastError: d.get("lastError") as string | undefined,
  }));

  const done = c.status === "done";
  const running = c.status === "running";
  const paused = c.status === "paused";
  // Settings "Har mail approve karke hi bhejo" is off: new drafts approve themselves and go out unread
  const auto = !s.approveEach;
  const sentTotal = counts.sent + counts.replied + counts.bounced + counts.opted_out;
  // Before the start: samples and Start need at least one Ready lead, and Start needs min(5, Ready) drafts.
  const canSample = !c.samplesApproved && remaining > 0;
  const want = Math.min(5, remaining);
  const partial = canSample && messages.length > 0 && messages.length < want; // some samples failed
  const samplesDone = c.samplesApproved || (canSample && messages.length >= want);
  // A finished campaign never mails the leads still in it, not even ones approved later.
  const stuck = done ? counts.needs_review + remaining : 0;
  // English plurals ("1 lead", "2 leads"); Hinglish keeps one form
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const steps: StepItem[] = [
    { label: t("5 sample drafts banao", "Make 5 sample drafts"), state: samplesDone ? "done" : "current" },
    { label: t("Padho aur start karo", "Read and start"), state: c.samplesApproved ? "done" : samplesDone ? "current" : "todo" },
    { label: auto ? t("Mails apne aap jaati hain", "Mails go out automatically") : t("Har mail approve karo", "Approve every mail"), href: auto ? "/sent" : "/review", state: done ? "done" : c.samplesApproved ? "current" : "todo" },
    { label: t("Bheji mails dekho", "See sent mails"), href: "/sent", state: done ? "current" : "todo" },
  ];

  const openApprove = t("Approve page kholo", "Open Approve page");
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
          "Campaign DRY-RUN mein chal raha hai: approve ki hui mails sirf aapke test address pe jaati hain, leads ko nahi. Nayi drafts Approve page pe approve karo aur test mails Sent page pe dekho. Sab theek ho to Dashboard se LIVE karo.",
          "The campaign is running in DRY-RUN: approved mails go only to your test address, not to the leads. Approve new drafts on the Approve page and check the test mails on the Sent page. If all looks good, switch to LIVE on the Dashboard.",
        ),
        href: "/review", cta: openApprove,
      }
    : auto
      ? {
        text: t(
          "Campaign chal raha hai. Auto-approve on hai: nayi drafts aapke padhe bina apne aap approve hoke sending window mein leads ko jaati hain. Rokna ho to Pause dabao; har mail pehle padhni ho to Settings mein ‘Har mail approve karke hi bhejo’ on karo.",
          "The campaign is running. Auto-approve is on: new drafts are approved automatically and go to the leads in the sending window without you reading them. To stop, press Pause; to read every mail first, turn on ‘Approve every mail before sending’ in Settings.",
        ),
        href: "/settings", cta: t("Settings dekho", "Open Settings"),
      }
      : {
        text: t(
          "Campaign chal raha hai. Nayi drafts Approve page pe aayengi: padh ke approve karo, tabhi worker unhe bhejega.",
          "The campaign is running. New drafts will show up on the Approve page: read and approve them; only then will the worker send them.",
        ),
        href: "/review", cta: openApprove,
      };

  // what to do next on this campaign
  const next: ComponentProps<typeof NextStep> =
    !c.samplesApproved && !remaining
      ? counts.needs_review > 0
        ? {
          text: t(
            `Is campaign mein abhi koi Ready lead nahi hai: ${counts.needs_review} leads ‘Review chahiye’ mein hain. Pehle Contacts page pe unhe approve karo, phir yahan samples banao.`,
            `This campaign has no Ready lead right now: ${plural(counts.needs_review, "lead is", "leads are")} in ‘Needs review’. First approve them on the Contacts page, then make the samples here.`,
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
      : !c.samplesApproved && !messages.length
        ? {
          text: t(
            "Pehle 5 sample drafts banao: neeche Controls mein ‘5 sample drafts banao’ dabao. AI list ke pehle 5 leads ke liye mail likhega, aap unhe padh ke decide karoge.",
            "First make 5 sample drafts: press ‘Make 5 sample drafts’ in Controls below. The AI writes a mail for the first 5 leads of the list; you read them and decide.",
          ),
        }
        : partial
          ? {
            text: t(
              `Sirf ${messages.length}/${want} sample drafts bane. Neeche Controls mein ‘5 sample drafts banao’ phir se dabao: sirf bache hue banenge. Saare ban jaayein, tab padh ke start karo.`,
              `Only ${messages.length}/${want} sample drafts were made. Press ‘Make 5 sample drafts’ in Controls below again: only the missing ones are made. Once all are made, read them and start.`,
            ),
            tone: "amber",
          }
          : !c.samplesApproved
            ? {
              text: t(
                "Neeche samples padho. Theek lagein to ‘Samples theek hain: approve karke start karo’ dabao.",
                "Read the samples below. If they look good, press ‘Samples look good: approve and start’.",
              ),
              href: "#mails", cta: t("Samples padho", "Read samples"),
            }
            : running
              ? runningNext
              : paused
                ? { text: t("Campaign ruka hua hai. Taiyaar ho to neeche Controls mein ‘Resume karo’ dabao.", "The campaign is paused. When you are ready, press ‘Resume’ in Controls below."), tone: "amber" }
                : done
                  ? { text: t("Campaign poora ho gaya. Ab replies dekho aur jawab do.", "The campaign is finished. Now read the replies and answer them."), href: "/replies", cta: t("Replies dekho", "See replies"), tone: "emerald" }
                  : { text: t("Bheji gayi mails ka poora record Sent page pe hai.", "The full record of sent mails is on the Sent page."), href: "/sent", cta: t("Bheji mails dekho", "See sent mails") };

  // one line about the buttons below it (NextStep already says what to do)
  const statusLine = !c.samplesApproved
    ? !remaining ? t("Abhi koi Ready lead nahi hai, isliye na samples ban sakte hain na campaign start ho sakta hai.", "There is no Ready lead right now, so no samples can be made and the campaign cannot start.")
      : partial ? t(`${messages.length}/${want} sample drafts bane. Start tabhi hoga jab saare ${want} ban jaayein.`, `${messages.length}/${want} sample drafts made. You can start only once all ${want} are made.`)
        : messages.length
          ? t(
            `${messages.length} sample draft taiyaar hain. Start karte hi ye approve ho jaate hain; ${auto ? "baaki mails apne aap approve hongi (auto-approve on hai)." : "baaki mails Approve page pe aayengi."}`,
            `${plural(messages.length, "sample draft is", "sample drafts are")} ready. Starting approves them; ${auto ? "the other mails are approved automatically (auto-approve is on)." : "the other mails will show up on the Approve page."}`,
          )
          : t("Start tabhi karo jab samples padh lo. Start karte hi ye samples approve ho jaate hain.", "Start only after you have read the samples. Starting approves these samples.")
    : running
      ? t(
        `Worker ${auto ? "nayi drafts apne aap approve karke" : "approve ki hui mails"} sending window mein ek-ek karke bhejta hai. Rokna ho to Pause dabao.`,
        `The worker ${auto ? "approves new drafts automatically and sends them" : "sends the approved mails"} one by one in the sending window. To stop, press Pause.`,
      )
      : paused ? t("Resume dabane tak is campaign se koi mail nahi jayegi.", "No mail goes out from this campaign until you press Resume.")
        : done ? t("Campaign poora ho gaya: ab is campaign se koi mail nahi jayegi.", "The campaign is finished: no more mails will go out from it.") : "";
  const showControls = !done || counts.check_manual > 0 || counts.already_contacted > 0;

  // AI drafts that failed: only a running campaign retries them by itself
  const showFailing = failing.length > 0 && !done && (c.samplesApproved || remaining > 0);
  const failText = !c.samplesApproved
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
  const failToast = !c.samplesApproved
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

  const startButton = (wide: string) => (
    <ActionButton action={startCampaign.bind(null, id)} label={t("Samples theek hain: approve karke start karo", "Samples look good: approve and start")} icon="play" className={wide}
      confirmText={t("Dobara dabao: approve karke start karo", "Press again: approve and start")} pendingText={t("Start ho raha hai…", "Starting…")}
      next={auto ? undefined : "/review"} nextCta={auto ? undefined : openApprove} />
  );

  const logo = (caption: string) => (
    <div className="border-t border-slate-100 px-3 py-2.5">
      <div className="mb-1.5 text-2xs text-slate-400">{caption}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`data:image/png;base64,${LOGO_PNG_BASE64}`} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt={t("Signature mein dikhne wala logo", "Logo shown in the signature")} className="h-auto max-w-full rounded border border-slate-200" />
    </div>
  );

  const mailsTitle = c.samplesApproved ? t("Latest drafts aur bheji gayi mails", "Latest drafts and sent mails") : t("Sample drafts (padh ke approve karo)", "Sample drafts (read and approve)");
  const emptyText = c.samplesApproved
    ? running ? t("Worker thodi-thodi der mein nayi drafts banata hai. Kuch der baad ye page dobara kholo.", "The worker writes new drafts every little while. Open this page again in a bit.")
      : paused ? t("Campaign ruka hua hai, isliye nayi drafts nahi ban rahi. ‘Resume karo’ dabane ke baad worker drafts banayega.", "The campaign is paused, so no new drafts are being made. After you press ‘Resume’, the worker will write drafts.")
        : t("Is campaign se koi mail nahi bani.", "No mail was made from this campaign.")
    : canSample ? t("Upar Controls mein ‘5 sample drafts banao’ dabao.", "Press ‘Make 5 sample drafts’ in Controls above.")
      : counts.needs_review > 0 ? t("Abhi koi Ready lead nahi hai. Pehle ‘Review chahiye’ wale leads Contacts mein approve karo, phir yahan samples banao.", "There is no Ready lead right now. First approve the ‘Needs review’ leads in Contacts, then make the samples here.")
        : t("Is campaign mein koi Ready lead nahi hai, isliye samples nahi ban sakte.", "This campaign has no Ready lead, so no samples can be made.");

  const manualCta = t("Manual check karo", "Check manually");
  const aiWriting = t("AI likh raha hai…", "AI is writing…");

  return (
    <div className="space-y-5">
      <PageHeader
        title={c.name}
        back={{ href: "/campaigns", label: "Campaigns" }}
        info={t(
          `Is campaign ka control page. Upar ke steps batate hain ki aap kahan ho. Pehle 5 sample drafts banao aur padho; theek lagein to approve karke start karo. ${auto ? "Start ke baad nayi mails apne aap approve hoke jaati hain (Settings mein auto-approve on hai)." : "Start ke baad har nayi mail Approve page pe aati hai."}`,
          `The control page of this campaign. The steps at the top show where you are. First make and read 5 sample drafts; if they look good, approve and start. ${auto ? "After the start, new mails are approved automatically and go out (auto-approve is on in Settings)." : "After the start, every new mail shows up on the Approve page."}`,
        )}
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge v={c.status} />
            {s.dryRun && <Badge v="dry-run" label="DRY-RUN" />}
            <span>{c.language.toUpperCase()} · {list?.name || t("List nahi mili", "List not found")}</span>
          </span>
        }
      />

      <div className="hidden md:block"><Steps steps={steps} /></div>
      <PhoneSteps steps={steps} />

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
          <Callout tone="warn" title={c.samplesApproved ? t("Kuch drafts retry ke liye ruke hain", "Some drafts are waiting for a retry") : t("Kuch sample drafts nahi ban paye", "Some sample drafts could not be made")}>
            <p>{failText}</p>
            <ul className="mt-2.5 space-y-1.5">
              {failing.map((f) => (
                <li key={f.id} className="min-w-0 rounded-lg bg-white/70 px-3 py-2 text-xs ring-1 ring-inset ring-amber-200/70">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {/* the id is the lead's email key: only "/" is escaped in it (never decodeURIComponent: a "%" in an address would crash the page) */}
                    <span className="break-all font-semibold">{f.id.replace(/%2F/g, "/")}</span>
                    <span>{t("Koshish", "Attempts")}: {f.attempts ?? "—"}</span>
                    {running && <span>{t("Agli koshish", "Next try")}: {fmt(f.nextTryAt)}</span>}
                  </div>
                  {f.lastError && <div className="mt-1 break-words font-mono text-2xs leading-relaxed">{f.lastError}</div>}
                </li>
              ))}
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
          "Campaign yahan se chalao.\n1. ‘5 sample drafts banao’: AI list ke pehle 5 leads ke liye mail likhta hai.\n2. Unhe padho; theek lagein to ‘approve karke start karo’ do baar dabao (galti se na ho, isliye).\n3. Chalte campaign ko kabhi bhi Pause kar sakte ho; Resume se wahin se aage chalega.",
          "Run the campaign from here.\n1. ‘Make 5 sample drafts’: the AI writes a mail for the first 5 leads of the list.\n2. Read them; if they look good, press ‘approve and start’ twice (so it never happens by mistake).\n3. You can pause a running campaign at any time; Resume carries on from where it stopped.",
        )}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {statusLine && <p className="min-w-0 text-sm text-slate-600">{statusLine}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:shrink-0">
            {canSample && <>
              <ActionButton action={samplesAction.bind(null, id)} label={t("5 sample drafts banao", "Make 5 sample drafts")} icon="bot" pendingText={aiWriting} className={`${!messages.length || partial ? "btn-primary" : "btn"} ${WIDE}`} />
              {startButton(`${messages.length && !partial ? "btn-primary" : "btn"} ${WIDE}`)}
            </>}
            {running && <ActionButton action={pauseCampaign.bind(null, id)} label={t("Pause karo", "Pause")} icon="pause" className={`btn ${WIDE}`} />}
            {paused && <ActionButton action={resumeCampaign.bind(null, id)} label={t("Resume karo", "Resume")} icon="play" className={`btn-primary ${WIDE}`} next={auto ? undefined : "/review"} nextCta={auto ? undefined : openApprove} />}
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("Baaki", "Remaining")} value={remaining} icon="clock" tone="sky"
          info={done
            ? t(
              "Campaign poora ho chuka hai, isliye is campaign se ab koi mail nahi jayegi: na Ready leads ko, na ‘Review chahiye’ wale leads ko (approve karne par bhi nahi).",
              "The campaign is finished, so it will not send any more mail: not to Ready leads and not to ‘Needs review’ leads (not even if you approve them).",
            )
            : t(
              "Is campaign mein kitne leads ko abhi mail jaani baaki hai (status Ready). ‘Review chahiye’ wale leads ko pehle Contacts page pe approve karna hoga. Unhe Ready leads khatam hone se pehle approve karo, warna campaign khatam ho jayega aur wo reh jayenge.",
              "How many leads in this campaign still have to get a mail (status Ready). ‘Needs review’ leads must first be approved on the Contacts page. Approve them before the Ready leads run out, otherwise the campaign ends and they are left out.",
            )}
          sub={counts.needs_review > 0 && !done
            ? <Link href="/contacts?status=needs_review" className="link">{t("Review chahiye", "Needs review")}: {counts.needs_review}</Link>
            : `${t("Review chahiye", "Needs review")}: ${counts.needs_review}`} />
        <Stat label={t("Bheji gayi", "Sent")} value={sentTotal} icon="send" tone="emerald"
          info={t(
            "Is campaign se kitni mails ja chuki hain. Neeche likha hai kitno ne reply kiya, kitni bounce hui aur kitno ne opt-out kiya.",
            "How many mails this campaign has sent. Below it: how many leads replied, how many mails bounced and how many leads opted out.",
          )}
          sub={<Parts items={[t(`Reply ${counts.replied}`, `Replies ${counts.replied}`), t(`Bounce ${counts.bounced}`, `Bounces ${counts.bounced}`), t(`Opt-out ${counts.opted_out}`, `Opt-outs ${counts.opted_out}`)]} />} />
        <Stat label={t("Kab tak khatam", "Estimated finish")} value={done ? t("Poora ho gaya", "Finished") : <span className="text-lg sm:text-2xl">{running ? fmtDate(finish) : paused ? t("Ruka hua", "Paused") : t("Start ke baad", "Once started")}</span>} icon="calendar" tone="indigo"
          info={t(
            "Andaza ki aakhri mail kab tak jayegi (date sirf chalte campaign ki). Aaj ki daily limit, warm-up (limit roz thodi badhti hai) aur sending window se nikala gaya hai. Pehle bana koi campaign bhi chal raha ho to uski mails pehle jaati hain; Campaigns list ka andaza unhe bhi ginta hai, isliye wahan date baad ki ho sakti hai.",
            "An estimate of when the last mail will go out (the date shows only for a running campaign). It is worked out from today's daily limit, the warm-up (the limit grows a little each day) and the sending window. If an older campaign is also running, its mails go first; the estimate on the Campaigns list counts them too, so the date there can be later.",
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
            <Info title={mailsTitle} text={c.samplesApproved
              ? t(
                `Is campaign ki aakhri 30 mails: jo ${auto ? "" : "approval ya "}sending ke liye ruki hain aur jo ja chuki hain. Bheji gayi mail mein wahi text hai jo bhejte waqt save hua, yaani bilkul jo lead ko gaya. Na gayi mails aaj ki signature aur footer ke saath dikhti hain, jaise jayengi.`,
                `The last 30 mails of this campaign: the ones waiting for ${auto ? "" : "approval or "}sending and the ones already sent. A sent mail shows the text saved at sending time, exactly what the lead got. Unsent mails show with today's signature and footer, the way they will go out.`,
              )
              : t(
                "AI ne list ke pehle 5 leads ke liye ye mails likhi hain. Har mail waise hi dikh rahi hai jaise lead ko jayegi (signature aur footer ke saath). English translation sirf aapke padhne ke liye hai, wo nahi jaati. Koi mail pasand na aaye to ‘Naya version likho’ dabao.",
                "The AI wrote these mails for the first 5 leads of the list. Each mail shows exactly as the lead will get it (with signature and footer). The English translation is only for you to read; it is not sent. If you don't like a mail, press ‘Write a new version’.",
              )} />
          </div>
          {messages.length > 0 && <span className="badge shrink-0">{t(`${messages.length} mail`, plural(messages.length, "mail", "mails"))}</span>}
        </div>

        {messages.map((m) => {
          // a mail that went out (or may have) shows the text saved at sending time; the rest are built from today's settings
          const stored = !!m.sentText;
          const label = stored
            ? (m.status === "sent" || m.status === "bounced" ? t("Mail jo gayi", "Mail as sent") : t("Mail jo bhejne ki koshish hui", "Mail we tried to send"))
            : UNSENT.includes(m.status) ? t("Mail (jaisi jayegi)", "Mail (as it will go out)") : t("Mail (footer aaj ki settings se)", "Mail (footer from today's settings)");
          const text = m.sentText || fullText(s, m.body, m.language, list?.sourceNote || NO_SOURCE);
          const footer = stored
            ? m.sentWithLogo ? logo(t("Logo (is mail mein signature ke neeche tha)", "Logo (was below the signature in this mail)")) : undefined
            : s.signatureLogo ? logo(t("Logo (HTML mail mein signature ke neeche)", "Logo (below the signature in the HTML mail)")) : undefined;
          return (
            <article key={m.id} className="card space-y-4">
              <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge v={m.status} />
                    {m.status === "ready" && m.approved === false && <Badge v="approval" label={t("Approval baaki", "Awaiting approval")} tone="amber" dot={false} />}
                    {m.status === "ready" && m.approved === true && <Badge v="approved" label={t("Approve ho gayi", "Approved")} tone="emerald" dot={false} />}
                    {m.dryRunDone && <Badge v="dry-run" label={t("Dry-run mein gayi", "Sent in dry-run")} dot={false} />}
                    {m.businessName && <span className="min-w-0 break-words font-semibold text-slate-900">{m.businessName}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    <span className="break-all">{m.leadEmail}</span>
                    {m.sentAt && <span className="inline-flex items-center gap-1"><Icon name="send" size={12} />{t("Bheji", "Sent")}: {fmt(m.sentAt)}</span>}
                    {m.status === "retry" && m.nextAttemptAt && <span className="inline-flex items-center gap-1"><Icon name="clock" size={12} />{t("Agli koshish", "Next try")}: {fmt(m.nextAttemptAt)}</span>}
                  </div>
                </div>
                {m.status === "ready" && (
                  <ActionButton action={regenerateDraft.bind(null, m.id)} label={t("Naya version likho", "Write a new version")} icon="refresh" className="btn btn-sm" pendingText={aiWriting}
                    next={c.samplesApproved && !auto ? "/review" : undefined} nextCta={c.samplesApproved && !auto ? openApprove : undefined} />
                )}
              </header>
              <div className={m.bodyEn ? "grid gap-4 md:grid-cols-2" : "max-w-2xl"}>
                <MailPreview label={label} subject={m.subject} text={text} footer={footer} />
                {m.bodyEn && <MailPreview label="English translation" subject={m.subjectEn || undefined} text={m.bodyEn} tone="translation" />}
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
            <EmptyState icon="bot" title={t("Abhi koi draft nahi", "No drafts yet")} text={emptyText} />
          </div>
        )}

        {canSample && messages.length > 0 && !partial && (
          <NextStep title={t("Saare samples padh liye?", "Read all the samples?")} tone="emerald"
            text={t("Theek lagein to start karo. Koi mail pasand na aaye to us par ‘Naya version likho’ dabao.", "If they look good, start. If you don't like a mail, press ‘Write a new version’ on it.")}>
            {startButton(`btn-primary ${WIDE}`)}
          </NextStep>
        )}
      </section>
    </div>
  );
}

type StepItem = { label: string; state: StepState; href?: string };

/** Phones and small tablets: the step pills do not fit in one row, so show the current step with a small 4-part bar. */
function PhoneSteps({ steps }: { steps: StepItem[] }) {
  const i = Math.max(0, steps.findIndex((s) => s.state === "current"));
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
      <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
        {steps.map((s, k) => <span key={k} className={`h-1.5 rounded-full ${s.state === "done" ? "bg-emerald-500" : s.state === "current" ? "bg-indigo-500" : "bg-slate-200"}`} />)}
      </div>
    </div>
  );
}

/** "a · b · c" where each part stays on one line (no break inside "Opt-out" or "09:30-17:30"). */
function Parts({ items }: { items: string[] }) {
  return <>{items.map((x, i) => <span key={i}>{i > 0 && " · "}<span className="whitespace-nowrap">{x}</span></span>)}</>;
}
