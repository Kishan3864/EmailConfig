import Link from "next/link";
import type { ComponentProps } from "react";
import { notFound } from "next/navigation";
import { C, count, rows, type Campaign, type Message, type LeadList } from "@/lib/fsdb";
import { getSettings } from "@/lib/settings";
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

export const metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
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

  const steps: StepItem[] = [
    { label: "5 sample drafts banao", state: samplesDone ? "done" : "current" },
    { label: "Padho aur start karo", state: c.samplesApproved ? "done" : samplesDone ? "current" : "todo" },
    { label: auto ? "Mails apne aap jaati hain" : "Har mail approve karo", href: auto ? "/sent" : "/review", state: done ? "done" : c.samplesApproved ? "current" : "todo" },
    { label: "Bheji mails dekho", href: "/sent", state: done ? "current" : "todo" },
  ];

  const runningNext: ComponentProps<typeof NextStep> = s.dryRun
    ? auto
      ? { text: "Campaign DRY-RUN mein chal raha hai: drafts apne aap approve hoke sirf aapke test address pe jaati hain, leads ko nahi. Test mails Sent page pe dekho; sab theek ho to Dashboard se LIVE karo.", href: "/#mode", cta: "Mode dekho" }
      : { text: "Campaign DRY-RUN mein chal raha hai: approve ki hui mails sirf aapke test address pe jaati hain, leads ko nahi. Nayi drafts Approve page pe approve karo aur test mails Sent page pe dekho. Sab theek ho to Dashboard se LIVE karo.", href: "/review", cta: "Approve page kholo" }
    : auto
      ? { text: "Campaign chal raha hai. Auto-approve on hai: nayi drafts aapke padhe bina apne aap approve hoke sending window mein leads ko jaati hain. Rokna ho to Pause dabao; har mail pehle padhni ho to Settings mein ‘Har mail approve karke hi bhejo’ on karo.", href: "/settings", cta: "Settings dekho" }
      : { text: "Campaign chal raha hai. Nayi drafts Approve page pe aayengi: padh ke approve karo, tabhi worker unhe bhejega.", href: "/review", cta: "Approve page kholo" };

  // what to do next on this campaign
  const next: ComponentProps<typeof NextStep> =
    !c.samplesApproved && !remaining
      ? counts.needs_review > 0
        ? { text: `Is campaign mein abhi koi Ready lead nahi hai: ${counts.needs_review} leads ‘Review chahiye’ mein hain. Pehle Contacts page pe unhe approve karo, phir yahan samples banao.`, href: "/contacts?status=needs_review", cta: "Review wale leads dekho", tone: "amber" }
        : { text: "Is campaign mein bhejne layak koi lead nahi bacha (na Ready, na ‘Review chahiye’), isliye isse koi mail nahi jayegi. Nayi leads import karke naya campaign banao.", href: "/import", cta: "Leads import karo", tone: "amber" }
      : !c.samplesApproved && !messages.length
        ? { text: "Pehle 5 sample drafts banao: neeche Controls mein ‘5 sample drafts banao’ dabao. AI list ke pehle 5 leads ke liye mail likhega, aap unhe padh ke decide karoge." }
        : partial
          ? { text: `Sirf ${messages.length}/${want} sample drafts bane. Neeche Controls mein ‘5 sample drafts banao’ phir se dabao: sirf bache hue banenge. Saare ban jaayein, tab padh ke start karo.`, tone: "amber" }
          : !c.samplesApproved
            ? { text: "Neeche samples padho. Theek lagein to ‘Samples theek hain: approve karke start karo’ dabao.", href: "#mails", cta: "Samples padho" }
            : running
              ? runningNext
              : paused
                ? { text: "Campaign ruka hua hai. Taiyaar ho to neeche Controls mein ‘Resume karo’ dabao.", tone: "amber" }
                : done
                  ? { text: "Campaign poora ho gaya. Ab replies dekho aur jawab do.", href: "/replies", cta: "Replies dekho", tone: "emerald" }
                  : { text: "Bheji gayi mails ka poora record Sent page pe hai.", href: "/sent", cta: "Bheji mails dekho" };

  // one line about the buttons below it (NextStep already says what to do)
  const statusLine = !c.samplesApproved
    ? !remaining ? "Abhi koi Ready lead nahi hai, isliye na samples ban sakte hain na campaign start ho sakta hai."
      : partial ? `${messages.length}/${want} sample drafts bane. Start tabhi hoga jab saare ${want} ban jaayein.`
        : messages.length ? `${messages.length} sample draft taiyaar hain. Start karte hi ye approve ho jaate hain; ${auto ? "baaki mails apne aap approve hongi (auto-approve on hai)." : "baaki mails Approve page pe aayengi."}`
          : "Start tabhi karo jab samples padh lo. Start karte hi ye samples approve ho jaate hain."
    : running ? `Worker ${auto ? "nayi drafts apne aap approve karke" : "approve ki hui mails"} sending window mein ek-ek karke bhejta hai. Rokna ho to Pause dabao.`
      : paused ? "Resume dabane tak is campaign se koi mail nahi jayegi."
        : done ? "Campaign poora ho gaya: ab is campaign se koi mail nahi jayegi." : "";
  const showControls = !done || counts.check_manual > 0 || counts.already_contacted > 0;

  // AI drafts that failed: only a running campaign retries them by itself
  const showFailing = failing.length > 0 && !done && (c.samplesApproved || remaining > 0);
  const failText = !c.samplesApproved
    ? "AI in leads ke liye sample draft nahi likh paya. Start se pehle ye apne aap dobara try nahi hote: neeche Controls mein ‘5 sample drafts banao’ phir se dabao, sirf bache hue banenge."
    : paused
      ? "AI in leads ke liye draft nahi likh paya. Campaign ruka hua hai, isliye abhi dobara try nahi hoga: ‘Resume karo’ dabane ke baad app apne aap dobara try karega."
      : "AI in leads ke liye draft nahi likh paya. App thodi der baad apne aap dobara try karega.";
  const failToast = !c.samplesApproved
    ? { title: "Kuch sample drafts nahi ban paye", text: `${failing.length} lead ke sample draft nahi bane. ‘5 sample drafts banao’ phir se dabao.` }
    : paused
      ? { title: "Kuch drafts nahi ban paye", text: `${failing.length} lead ke draft ruke hain. ‘Resume karo’ ke baad app dobara try karega.` }
      : { title: "Kuch drafts nahi ban paye", text: `${failing.length} lead ke draft retry ke liye ruke hain. App apne aap dobara try karega.` };

  const startButton = (wide: string) => (
    <ActionButton action={startCampaign.bind(null, id)} label="Samples theek hain: approve karke start karo" icon="play" className={wide}
      confirmText="Dobara dabao: approve karke start karo" pendingText="Start ho raha hai…" next={auto ? undefined : "/review"} nextCta={auto ? undefined : "Approve page kholo"} />
  );

  const logo = (caption: string) => (
    <div className="border-t border-slate-100 px-3 py-2.5">
      <div className="mb-1.5 text-2xs text-slate-400">{caption}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`data:image/png;base64,${LOGO_PNG_BASE64}`} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="Signature mein dikhne wala logo" className="h-auto max-w-full rounded border border-slate-200" />
    </div>
  );

  const mailsTitle = c.samplesApproved ? "Latest drafts aur bheji gayi mails" : "Sample drafts (padh ke approve karo)";
  const emptyText = c.samplesApproved
    ? running ? "Worker thodi-thodi der mein nayi drafts banata hai. Kuch der baad ye page dobara kholo."
      : paused ? "Campaign ruka hua hai, isliye nayi drafts nahi ban rahi. ‘Resume karo’ dabane ke baad worker drafts banayega."
        : "Is campaign se koi mail nahi bani."
    : canSample ? "Upar Controls mein ‘5 sample drafts banao’ dabao."
      : counts.needs_review > 0 ? "Abhi koi Ready lead nahi hai. Pehle ‘Review chahiye’ wale leads Contacts mein approve karo, phir yahan samples banao."
        : "Is campaign mein koi Ready lead nahi hai, isliye samples nahi ban sakte.";

  return (
    <div className="space-y-5">
      <PageHeader
        title={c.name}
        back={{ href: "/campaigns", label: "Campaigns" }}
        info={`Is campaign ka control page. Upar ke steps batate hain ki aap kahan ho. Pehle 5 sample drafts banao aur padho; theek lagein to approve karke start karo. ${auto ? "Start ke baad nayi mails apne aap approve hoke jaati hain (Settings mein auto-approve on hai)." : "Start ke baad har nayi mail Approve page pe aati hai."}`}
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge v={c.status} />
            {s.dryRun && <Badge v="dry-run" label="DRY-RUN" />}
            <span>{c.language.toUpperCase()} · {list?.name || "List nahi mili"}</span>
          </span>
        }
      />

      <div className="hidden md:block"><Steps steps={steps} /></div>
      <PhoneSteps steps={steps} />

      <NextStep {...next} />

      {stuck > 0 && (
        <Callout tone="warn" title={`${stuck} ${stuck === 1 ? "lead" : "leads"} is campaign se nahi jayenge`}>
          Campaign poora ho chuka hai. Isme bache ‘Review chahiye’ ya baad mein approve hue leads ko ab is campaign se mail nahi jayegi, approve karne par bhi nahi.
        </Callout>
      )}

      {showFailing && (
        <>
          <Callout tone="warn" title={c.samplesApproved ? "Kuch drafts retry ke liye ruke hain" : "Kuch sample drafts nahi ban paye"}>
            <p>{failText}</p>
            <ul className="mt-2.5 space-y-1.5">
              {failing.map((f) => (
                <li key={f.id} className="min-w-0 rounded-lg bg-white/70 px-3 py-2 text-xs ring-1 ring-inset ring-amber-200/70">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {/* the id is the lead's email key: only "/" is escaped in it (never decodeURIComponent: a "%" in an address would crash the page) */}
                    <span className="break-all font-semibold">{f.id.replace(/%2F/g, "/")}</span>
                    <span>Koshish: {f.attempts ?? "—"}</span>
                    {running && <span>Agli koshish: {fmt(f.nextTryAt)}</span>}
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
          <Callout tone="danger" title={`${counts.check_manual} mail ka status pakka nahi hai`}
            action={<Link href="/contacts?status=check_manual" className="btn btn-sm w-full sm:w-auto">Manual check karo<Icon name="arrow-right" size={13} /></Link>}>
            SMTP server ne saaf jawab nahi diya, isliye pata nahi mail gayi ya nahi. Har contact kholo, mailbox ka Sent folder dekho aur ‘Haan, mail gayi thi’ ya ‘Nahi gayi’ dabao. Ye mails apne aap dobara kabhi nahi jaati.
          </Callout>
          <ToastOnMount kind="error" title="Kuch mails manual check maang rahi hain" text={`${counts.check_manual} mail ka status pakka nahi hai. Har contact kholo, Sent folder dekho aur mark karo.`} href="/contacts?status=check_manual" cta="Manual check karo" once={`manual:${id}:${counts.check_manual}`} />
        </>
      )}

      {showControls && <Section id="controls" title="Controls" icon="sliders"
        info={"Campaign yahan se chalao.\n1. ‘5 sample drafts banao’: AI list ke pehle 5 leads ke liye mail likhta hai.\n2. Unhe padho; theek lagein to ‘approve karke start karo’ do baar dabao (galti se na ho, isliye).\n3. Chalte campaign ko kabhi bhi Pause kar sakte ho; Resume se wahin se aage chalega."}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {statusLine && <p className="min-w-0 text-sm text-slate-600">{statusLine}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:shrink-0">
            {canSample && <>
              <ActionButton action={samplesAction.bind(null, id)} label="5 sample drafts banao" icon="bot" pendingText="AI likh raha hai…" className={`${!messages.length || partial ? "btn-primary" : "btn"} ${WIDE}`} />
              {startButton(`${messages.length && !partial ? "btn-primary" : "btn"} ${WIDE}`)}
            </>}
            {running && <ActionButton action={pauseCampaign.bind(null, id)} label="Pause karo" icon="pause" className={`btn ${WIDE}`} />}
            {paused && <ActionButton action={resumeCampaign.bind(null, id)} label="Resume karo" icon="play" className={`btn-primary ${WIDE}`} next={auto ? undefined : "/review"} nextCta={auto ? undefined : "Approve page kholo"} />}
            {counts.check_manual > 0 && (
              <Link className={`btn ${WIDE} text-red-700 hover:text-red-800`} href="/contacts?status=check_manual">
                <Icon name="alert" size={14} />{counts.check_manual} mail manual check karo
              </Link>
            )}
          </div>
        </div>
        {counts.already_contacted > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <Badge v="already_contacted" label={`${counts.already_contacted} leads skip hue`} />
            <span>Ye pehle contact ho chuke the</span>
            <Info title="Pehle contact hue leads" size={13} text="Ye leads Contacted Ledger mein pehle se the, yaani inhe kabhi na kabhi mail ja chuki hai. Inhe dobara cold mail kabhi nahi jayegi." />
          </div>
        )}
      </Section>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Baaki" value={remaining} icon="clock" tone="sky"
          info={done
            ? "Campaign poora ho chuka hai, isliye is campaign se ab koi mail nahi jayegi: na Ready leads ko, na ‘Review chahiye’ wale leads ko (approve karne par bhi nahi)."
            : "Is campaign mein kitne leads ko abhi mail jaani baaki hai (status Ready). ‘Review chahiye’ wale leads ko pehle Contacts page pe approve karna hoga. Unhe Ready leads khatam hone se pehle approve karo, warna campaign khatam ho jayega aur wo reh jayenge."}
          sub={counts.needs_review > 0 && !done
            ? <Link href="/contacts?status=needs_review" className="link">Review chahiye: {counts.needs_review}</Link>
            : `Review chahiye: ${counts.needs_review}`} />
        <Stat label="Bheji gayi" value={sentTotal} icon="send" tone="emerald"
          info="Is campaign se kitni mails ja chuki hain. Neeche likha hai kitno ne reply kiya, kitni bounce hui aur kitno ne opt-out kiya."
          sub={<Parts items={[`Reply ${counts.replied}`, `Bounce ${counts.bounced}`, `Opt-out ${counts.opted_out}`]} />} />
        <Stat label="Kab tak khatam" value={done ? "Poora ho gaya" : <span className="text-lg sm:text-2xl">{running ? fmtDate(finish) : paused ? "Ruka hua" : "Start ke baad"}</span>} icon="calendar" tone="indigo"
          info="Andaza ki aakhri mail kab tak jayegi (date sirf chalte campaign ki). Aaj ki daily limit, warm-up (limit roz thodi badhti hai) aur sending window se nikala gaya hai. Pehle bana koi campaign bhi chal raha ho to uski mails pehle jaati hain; Campaigns list ka andaza unhe bhi ginta hai, isliye wahan date baad ki ho sakti hai."
          sub={<Parts items={[`Aaj ki limit ${cap}/din`, `${s.windowStart}-${s.windowEnd}`, c.timezone]} />} />
        <Stat label="Bhasha / List" value={c.language.toUpperCase()} icon="globe" tone="violet"
          info="Mails is bhasha mein likhi jaati hain. List wahi hai jisse campaign bana. ‘Kahan se mile’ mail ke footer mein likha jaata hai (address kahan se mila)."
          sub={<span className="break-words">{list?.name || "—"} · Kahan se mile: {list?.sourceNote || NO_SOURCE}</span>} />
      </div>

      <section id="mails" className="scroll-mt-20 space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-200/60 text-slate-500"><Icon name="mail" size={15} /></span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <h2 className="h2">{mailsTitle}</h2>
            <Info title={mailsTitle} text={c.samplesApproved
              ? `Is campaign ki aakhri 30 mails: jo ${auto ? "" : "approval ya "}sending ke liye ruki hain aur jo ja chuki hain. Bheji gayi mail mein wahi text hai jo bhejte waqt save hua, yaani bilkul jo lead ko gaya. Na gayi mails aaj ki signature aur footer ke saath dikhti hain, jaise jayengi.`
              : "AI ne list ke pehle 5 leads ke liye ye mails likhi hain. Har mail waise hi dikh rahi hai jaise lead ko jayegi (signature aur footer ke saath). English translation sirf aapke padhne ke liye hai, wo nahi jaati. Koi mail pasand na aaye to ‘Naya version likho’ dabao."} />
          </div>
          {messages.length > 0 && <span className="badge shrink-0">{messages.length} mail</span>}
        </div>

        {messages.map((m) => {
          // a mail that went out (or may have) shows the text saved at sending time; the rest are built from today's settings
          const stored = !!m.sentText;
          const label = stored ? (m.status === "sent" || m.status === "bounced" ? "Mail jo gayi" : "Mail jo bhejne ki koshish hui")
            : UNSENT.includes(m.status) ? "Mail (jaisi jayegi)" : "Mail (footer aaj ki settings se)";
          const text = m.sentText || fullText(s, m.body, m.language, list?.sourceNote || NO_SOURCE);
          const footer = stored
            ? m.sentWithLogo ? logo("Logo (is mail mein signature ke neeche tha)") : undefined
            : s.signatureLogo ? logo("Logo (HTML mail mein signature ke neeche)") : undefined;
          return (
            <article key={m.id} className="card space-y-4">
              <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge v={m.status} />
                    {m.status === "ready" && m.approved === false && <Badge v="approval" label="Approval baaki" tone="amber" dot={false} />}
                    {m.status === "ready" && m.approved === true && <Badge v="approved" label="Approve ho gayi" tone="emerald" dot={false} />}
                    {m.dryRunDone && <Badge v="dry-run" label="Dry-run mein gayi" dot={false} />}
                    {m.businessName && <span className="min-w-0 break-words font-semibold text-slate-900">{m.businessName}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    <span className="break-all">{m.leadEmail}</span>
                    {m.sentAt && <span className="inline-flex items-center gap-1"><Icon name="send" size={12} />Bheji: {fmt(m.sentAt)}</span>}
                    {m.status === "retry" && m.nextAttemptAt && <span className="inline-flex items-center gap-1"><Icon name="clock" size={12} />Agli koshish: {fmt(m.nextAttemptAt)}</span>}
                  </div>
                </div>
                {m.status === "ready" && (
                  <ActionButton action={regenerateDraft.bind(null, m.id)} label="Naya version likho" icon="refresh" className="btn btn-sm" pendingText="AI likh raha hai…"
                    next={c.samplesApproved && !auto ? "/review" : undefined} nextCta={c.samplesApproved && !auto ? "Approve page kholo" : undefined} />
                )}
              </header>
              <div className={m.bodyEn ? "grid gap-4 md:grid-cols-2" : "max-w-2xl"}>
                <MailPreview label={label} subject={m.subject} text={text} footer={footer} />
                {m.bodyEn && <MailPreview label="English translation" subject={m.subjectEn || undefined} text={m.bodyEn} tone="translation" />}
              </div>
              {m.smtpResponse && (
                <p className="break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
                  <span className="font-sans font-medium text-slate-400">SMTP jawab: </span>{m.smtpResponse}
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
            <EmptyState icon="bot" title="Abhi koi draft nahi" text={emptyText} />
          </div>
        )}

        {canSample && messages.length > 0 && !partial && (
          <NextStep title="Saare samples padh liye?" tone="emerald" text="Theek lagein to start karo. Koi mail pasand na aaye to us par ‘Naya version likho’ dabao.">
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
  return <>{items.map((t, i) => <span key={i}>{i > 0 && " · "}<span className="whitespace-nowrap">{t}</span></span>)}</>;
}
