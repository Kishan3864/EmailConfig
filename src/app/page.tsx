import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { C, count, rows, type Campaign } from "@/lib/fsdb";
import { getSettings, getState } from "@/lib/settings";
import { capFor, priorSendingDays, sentToday, estimateFinish, nextWindowOpen } from "@/lib/schedule";
import { fmt, fmtDate, dayStart, partsIn, DISPLAY_TZ } from "@/lib/time";
import { Badge, Callout, EmptyState, NextStep, PageHeader, Progress, Section, Stat, type Tone } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { Info } from "@/components/Info";
import { ActionButton } from "@/components/ActionButton";
import { ToastOnMount } from "@/components/toast";
import { globalStopAction, clearStopAction, setModeAction } from "./actions";

export const metadata = { title: "Dashboard" };

type Issue = { tone: "danger" | "warn" | "info"; title: string; text?: string; href: string; cta: string };
/** now = what exactly is still missing (shown on an open step) */
type SetupStep = { title: string; how: string; info: string; href: string; cta: string; done: boolean; now?: string };
/** step = index of the setup step the card shows (its row in the Setup guide then gets a quiet button) */
type Guide = ComponentProps<typeof NextStep> & { step?: number };

const ISSUE_LOOK: Record<Issue["tone"], { icon: IconName; color: string; rank: number }> = {
  danger: { icon: "x-circle", color: "bg-red-50 text-red-600", rank: 0 },
  warn: { icon: "alert", color: "bg-amber-50 text-amber-600", rank: 1 },
  info: { icon: "info", color: "bg-sky-50 text-sky-600", rank: 2 },
};

const HEALTH = {
  green: { label: "Sab theek", dot: "bg-emerald-500", tone: "emerald" },
  amber: { label: "Dhyan do", dot: "bg-amber-400", tone: "amber" },
  red: { label: "Problem", dot: "bg-red-500", tone: "red" },
} satisfies Record<string, { label: string; dot: string; tone: Tone }>;

/** Short IST time: "Aaj 14:30", "Kal 09:30" (kal = yesterday or tomorrow, the tile makes it clear) or "18 Oct, 09:30". */
function when(d: Date | string | null | undefined) {
  if (!d) return "—";
  const t = new Date(d);
  const day = (x: Date) => partsIn(x, DISPLAY_TZ).dayKey;
  const now = Date.now();
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
  if (day(t) === day(new Date(now))) return `Aaj ${time}`;
  if (day(t) === day(new Date(now + 864e5)) || day(t) === day(new Date(now - 864e5))) return `Kal ${time}`;
  return new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
}

const strong = (t: ReactNode) => <span className="font-semibold text-slate-900">{t}</span>;

export default async function Dashboard() {
  const [s, st, active] = await Promise.all([
    getSettings(),
    getState(),
    C.campaigns.where("status", "in", ["running", "paused", "draft"]).get().then((q) => rows<Campaign>(q).sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
  ]);
  const tz = active.find((c) => c.status === "running")?.timezone || active[0]?.timezone || "Europe/Paris";
  const runningIds = active.filter((c) => c.status === "running").map((c) => c.id);
  const byStatus = (status: string) => count(C.leads.where("status", "==", status));
  const ofCampaign = (id: string) => C.leads.where("campaignId", "==", id);
  const istToday = dayStart(new Date(), DISPLAY_TZ).toISOString();

  // all reads run in parallel; only the finish estimates further down depend on each other
  const [[prior, today, queue], [sent, replied, bounced, optedOut, review, manual, ledger], [liveToday, dryToday, waiting, approvedReady], [confirmedLists, approvedCampaigns, okSends], last50, sizes] = await Promise.all([
    Promise.all([priorSendingDays(tz), sentToday(tz), runningIds.length ? count(C.leads.where("campaignId", "in", runningIds.slice(0, 30)).where("status", "==", "ready")) : 0]),
    Promise.all([
      count(C.messages.where("status", "in", ["sent", "bounced"])), byStatus("replied"), byStatus("bounced"), byStatus("opted_out"), byStatus("needs_review"), byStatus("check_manual"), count(C.contacted),
    ]),
    Promise.all([
      count(C.sendLogs.where("ok", "==", true).where("at", ">=", istToday).where("dryRun", "==", false)),
      count(C.sendLogs.where("ok", "==", true).where("at", ">=", istToday).where("dryRun", "==", true)),
      count(C.messages.where("approved", "==", false).where("status", "==", "ready")),
      count(C.messages.where("approved", "==", true).where("status", "==", "ready")),
    ]),
    // setup guide
    Promise.all([count(C.lists.where("confirmed", "==", true)), count(C.campaigns.where("samplesApproved", "==", true)), count(C.sendLogs.where("ok", "==", true))]),
    C.messages.orderBy("sentAt", "desc").limit(50).get().then((q) => q.docs.map((d) => d.get("status") as string)),
    Promise.all(active.map((c) => Promise.all([count(ofCampaign(c.id)), count(ofCampaign(c.id).where("status", "==", "ready")), count(ofCampaign(c.id).where("status", "==", "needs_review"))]))),
  ]);
  const cap = capFor(s, prior);
  const bounceRate = last50.length ? last50.filter((x) => x === "bounced").length / last50.length : 0;
  const bouncePct = (bounceRate * 100).toFixed(1);
  const workerAlive = !!st.lastWorkerTick && Date.now() - new Date(st.lastWorkerTick).getTime() < 6 * 60000;
  const stopped = st.globalStop || !!st.alert;
  const dnsBad = !!st.dns && (!st.dns.spf || !st.dns.dkim);
  const noAlertTo = !s.alertEmail && !s.testEmail; // alert, reply and daily-report mails then have nobody to go to

  // problems (same checks as always), each with the page where it gets fixed
  const issues: Issue[] = [];
  if (st.alert) issues.push({ tone: "danger", title: "Sending apne aap ruk gayi (auto-pause)", text: st.alert.message, href: "#top", cta: "Upar se stop hatao" });
  if (st.globalStop) issues.push({ tone: "danger", title: "STOP on hai: koi mail nahi jayegi", text: "Problem theek karke upar se stop hatao.", href: "#top", cta: "Upar jao" });
  if (!workerAlive) issues.push({ tone: "warn", title: "Worker 6 minute se nahi chala", text: "Worker ke bina koi mail nahi jaati. Server pe pm2 status check karo.", href: "/logs", cta: "Logs dekho" });
  if (dnsBad) issues.push({ tone: "danger", title: "SPF ya DKIM missing hai", text: "Isse mails spam mein jaati hain. DNS theek kiye bina campaign start nahi hoga.", href: "/settings", cta: "Settings kholo" });
  if (!st.dns) issues.push({ tone: "warn", title: "DNS abhi check nahi hua", text: "Settings mein DNS check chalao (SPF, DKIM, DMARC).", href: "/settings", cta: "Settings kholo" });
  if (noAlertTo) issues.push({ tone: "warn", title: "Alert mails kahin nahi ja rahi", text: "Alert aur Test address khaali hain: auto-pause, reply aur report ki mail nahi aayegi.", href: "/settings#mailbox", cta: "Address daalo" });
  if (bounceRate > 0.02) issues.push({ tone: "warn", title: `Bounce rate ${bouncePct}% hai`, text: "Last 50 mails mein 2% se zyada bounce. 5% pe sending apne aap ruk jayegi.", href: "/contacts?status=bounced", cta: "Bounce dekho" });
  if (manual) issues.push({ tone: "warn", title: `${manual} mails ka manual check baaki hai`, text: "Pata nahi ye mails gayi ya nahi. Sent folder mein dekh ke mark karo.", href: "/contacts?status=check_manual", cta: "Check karo" });
  if (s.dryRun) issues.push({
    tone: "warn", title: "DRY-RUN mode on hai", href: "#mode", cta: "Mode dekho",
    text: s.testEmail ? "Mails sirf aapke test address pe jaa rahi hain, leads ko kuch nahi jaata." : "Test address set nahi hai, isliye abhi koi mail nahi jaa rahi (na lead ko, na aapko).",
  });
  const health = st.alert || st.globalStop || dnsBad ? "red" : issues.length ? "amber" : "green";
  const problems = issues.length;
  // the same checks, listed when they pass, so the panel shows what is being watched
  const passed = [
    !stopped && "Sending chalu hai, koi stop nahi",
    workerAlive && `Worker chal raha hai (${when(st.lastWorkerTick)})`,
    !!st.dns && !dnsBad && "DNS sahi hai: SPF aur DKIM mile",
    !noAlertTo && "Alert aur report mail ka address set hai",
    bounceRate <= 0.02 && `Bounce rate ${bouncePct}% (2% se kam)`,
    !manual && "Koi manual check baaki nahi",
    !s.dryRun && "LIVE mode on hai",
  ].filter((x): x is string => !!x);
  // a to-do, not a problem: it does not change the health colour
  if (review) issues.push({ tone: "info", title: `${review} leads review ke liye ruke hain`, text: "Approve ya reject karo, tabhi inhe mail jayegi.", href: "/contacts?status=needs_review", cta: "Review karo" });
  issues.sort((a, b) => ISSUE_LOOK[a.tone].rank - ISSUE_LOOK[b.tone].rank);
  // up to 2 rows fit beside today's tiles (big screens); more get the full width in two columns
  const wide = issues.length > 2;

  let next: Date | null = null;
  if (!stopped && queue > 0) {
    const gap = st.nextSendAt ? new Date(st.nextSendAt) : new Date();
    next = nextWindowOpen(gap > new Date() ? gap : new Date(), s, tz);
  }
  // the worker only sends approved mails: with none approved and some waiting, nothing leaves until I approve
  const needApproval = !!next && approvedReady === 0 && waiting > 0;
  const top = capFor(s, 1000); // the most the daily limit ever grows to (the same number Settings shows)
  const planCaps = s.planDailyLimit > 0 && top === Math.floor(s.planDailyLimit * 0.4); // the plan's 40%, not the warm-up, sets that maximum

  // finish estimates: mails of running campaigns created earlier go out first ("ahead")
  let ahead = 0;
  const progress = await Promise.all(active.map((c, i) => {
    const [total, remaining, rev] = sizes[i];
    const before = ahead;
    if (c.status === "running") ahead += remaining;
    return estimateFinish(s, c.timezone, remaining, before).then((finish) => ({ c, total, done: total - remaining - rev, remaining, finish }));
  }));

  const emptyFields = [!s.fromEmail && "From address", !s.testEmail && "Test address", !s.senderName && "Naam", !s.postalAddress && "Postal address"].filter(Boolean).join(", ");
  const setup: SetupStep[] = [
    {
      title: "Settings bharo", done: !!(s.fromEmail && s.testEmail && s.senderName && s.postalAddress), href: "/settings", cta: "Settings kholo",
      how: "From address, test address, apna naam aur postal address daalo.", now: emptyFields && `Abhi khaali: ${emptyFields}`,
      info: "Settings page pe Mailbox aur Sender profile bharo. From address se mails jaati hain, test address pe dry-run ki test mails aati hain. Postal address har mail ke footer mein jaata hai. SMTP password server ki .env file mein rehta hai.",
    },
    {
      title: "Test mail bhejo aur DNS check karo", done: !!(st.dns?.spf && st.dns?.dkim), href: "/settings", cta: "Settings kholo",
      how: "Settings se khud ko test mail bhejo, phir DNS check chalao. SPF aur DKIM dono sahi hone chahiye.",
      now: !st.dns ? "DNS abhi check nahi hua" : `${[!st.dns.spf && "SPF", !st.dns.dkim && "DKIM"].filter(Boolean).join(" aur ")} missing hai`,
      info: "Test mail se pata chalta hai ki SMTP sahi set hai. DNS check aapke domain ke SPF, DKIM aur DMARC record padhta hai. SPF ya DKIM na ho to mails spam mein jaati hain, isliye bina inke campaign start nahi hota.",
    },
    {
      title: "Purane contacts Ledger mein daalo", done: ledger > 0, href: "/ledger", cta: "Ledger kholo",
      how: "Jinko aap pehle mail kar chuke ho, unhe Ledger mein daalo.",
      info: "Ledger mein jo address hai use ye app kabhi cold mail nahi bhejta. Mailbox ke Sent folder se saare purane addresses ek click mein import karo, ya ek-ek karke add karo.",
    },
    {
      title: "Leads ki list import karo", done: confirmedLists > 0, href: "/import", cta: "Import karo",
      how: "CSV, Excel, PDF ya text se leads upload karo aur list confirm karo.",
      info: "Import page pe file daalo, columns match karo aur preview dekho. Galat, duplicate aur pehle contact hue address apne aap hat jaate hain. Confirm karne ke baad hi list campaign mein use hoti hai.",
    },
    {
      title: "Campaign banao, 5 samples padho aur start karo", done: approvedCampaigns > 0, href: "/campaigns", cta: "Campaign banao",
      how: "List chuno, 5 sample mails padho, theek lagein to campaign start karo.",
      info: "Campaigns page pe import ki hui list chuno. App pehle 5 sample mails likhta hai. Unhe dhyan se padho; theek lagein to approve karke campaign start karo.",
    },
    {
      title: "Mails approve karo, pehli mail jaane do", done: okSends > 0, href: "/review", cta: "Approve karo",
      how: s.approveEach
        ? "Approve page pe har draft padho aur approve karo. Worker sending window mein bhej dega."
        : "Auto-approve on hai: drafts apne aap approve hote hain. Worker sending window mein pehli mail bhej dega.",
      info: s.approveEach
        ? "AI ka likha har draft Approve page pe rukta hai. Padho, zarurat ho to edit karo, phir approve karo. Pehli mail (dry-run ki test mail bhi) successfully jaate hi ye step poora ho jata hai."
        : "Auto-approve on hai, isliye AI ke drafts apne aap approve hokar sending window mein bhej diye jaate hain. Approve page pe sirf wo drafts dikhte hain jo abhi bhi ruke hain. Pehli mail (dry-run ki test mail bhi) successfully jaate hi ye step poora ho jata hai.",
    },
    {
      title: "Sab theek lage to LIVE mode on karo", done: !s.dryRun, href: "/#mode", cta: "Mode pe jao",
      how: "Dry-run ki test mails sahi lagein to Sending mode mein LIVE karo.",
      info: "Dry-run mein mails sirf aapke test address pe jaati hain. LIVE karne ke baad approve ki hui mails asli leads ko jaane lagti hain. Kabhi bhi wapas DRY-RUN kar sakte ho.",
    },
  ];
  const setupDone = setup.filter((x) => x.done).length;
  const todo = setup.findIndex((x) => !x.done);

  // "Aapka agla step": the first thing that applies wins. A stop always comes first. An open setup step leads only
  // on a true first run (nothing sent yet); after that approvals, manual checks and reviews come before it.
  const openStep: Guide | null = todo < 0 ? null : {
    step: todo, href: setup[todo].href, cta: setup[todo].cta,
    text: <>{strong(`Step ${todo + 1}/7: ${setup[todo].title}.`)} {setup[todo].now ? `${setup[todo].now}.` : setup[todo].how}</>,
  };
  const { step: guideStep = -1, ...guide } = ((): Guide => {
    if (stopped) return { tone: "amber", text: <>{strong("Sending ruki hui hai.")} Pehle problem theek karo, phir upar se stop hatao.</>, href: "/logs", cta: "Logs dekho" };
    if (openStep && okSends === 0) return openStep;
    if (waiting > 0) return { text: <>{strong(`${waiting} mails aapke approval ka wait kar rahi hain.`)} Padho aur approve karo, tabhi wo jayengi.</>, href: "/review", cta: "Approve karo" };
    if (manual > 0) return { tone: "amber", text: <>{strong(`${manual} mails ka manual check baaki hai.`)} Sent folder mein dekho ki mail gayi ya nahi, phir contact pe mark karo.</>, href: "/contacts?status=check_manual", cta: "Check karo" };
    if (review > 0) return { text: <>{strong(`${review} leads review ke liye ruke hain.`)} Approve ya reject karo, tabhi campaign aage badhega.</>, href: "/contacts?status=needs_review", cta: "Review karo" };
    if (openStep) return openStep;
    if (!runningIds.length) return { text: <>{strong("Abhi koi campaign nahi chal raha.")} Naya campaign banao ya ruka hua campaign resume karo.</>, href: "/campaigns", cta: "Campaigns kholo" };
    if (queue === 0) return { text: <>{strong("Chal rahe campaigns mein koi lead baaki nahi.")} Aur mails bhejne ke liye nayi list import karo.</>, href: "/import", cta: "Nayi list import karo" };
    return { tone: "emerald", text: <>{strong("Sab chal raha hai.")} Worker sending window mein mails bhej raha hai.</>, href: "/sent", cta: "Aaj ki mails dekho" };
  })();

  const clearStop = <ActionButton action={clearStopAction} icon="check-circle" label="Stop / alert hatao" confirmText="Dobara dabao: problem theek kar di hai" next="/campaigns" nextCta="Campaigns kholo" />;
  const h = HEALTH[health];

  return (
    <div className="space-y-5">
      {st.alert && (
        <Callout tone="danger" title="Sending apne aap ruk gayi (auto-pause)" action={clearStop}>
          <span className="break-words">{st.alert.message}</span> · {fmt(st.alert.at)}
        </Callout>
      )}

      <PageHeader
        title="Dashboard"
        info="Ye aapka control room hai: aaj kitni mails gayi, kitni approval ke liye ruki hain, agla step kya hai aur kahin koi problem to nahi. Emergency mein 'Saari sending roko' dabao, sab turant ruk jayega. Har box ke (i) mein uski jaankari hai."
        sub="Aaj ka haal · Sab samay IST (Asia/Kolkata) mein"
        actions={stopped
          ? !st.alert && clearStop /* with an alert the button sits in the red box above */
          : <ActionButton action={globalStopAction} className="btn-danger" icon="stop" label="Saari sending roko" />}
      />

      <NextStep title="Aapka agla step" {...guide} />

      {setupDone < 7 && (
        <Section
          flush
          title="Setup guide"
          icon="flag"
          info="Pehli baar app chalane ke liye ye 7 kaam isi order mein karo. Har step ke saamne wale button se seedha us page pe jao. Kaam hote hi yahan hara tick lag jata hai."
          sub="Pehli baar ye 7 kaam isi order mein karo"
          actions={
            <div className="flex items-center gap-2">
              <div className="w-20 sm:w-28"><Progress value={setupDone / 7} /></div>
              <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-slate-600">{setupDone}/7 poore</span>
            </div>
          }
        >
          <SetupList steps={setup} current={todo} guided={guideStep} show="todo" />
          {setupDone > 0 && (
            <details className="group/done border-t border-slate-100">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50/70 hover:text-slate-700 sm:px-5">
                <Icon name="check-circle" size={14} className="text-emerald-500" />
                {setupDone} {setupDone === 1 ? "kaam ho gaya" : "kaam ho gaye"}
                <span className="text-slate-400">· dekhne ke liye kholo</span>
                <Icon name="chevron-down" size={14} className="ml-auto text-slate-400 transition group-open/done:rotate-180" />
              </summary>
              <div className="border-t border-slate-100"><SetupList steps={setup} current={-1} show="done" /></div>
            </details>
          )}
        </Section>
      )}

      {/* the sidebar and the app bar link here (/#mode) */}
      <Section id="mode" className={`scroll-mt-20 ${s.dryRun ? "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-white" : "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white"}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-sm ${s.dryRun ? "bg-amber-500 shadow-amber-500/30" : "bg-emerald-600 shadow-emerald-600/30"}`}>
              <Icon name={s.dryRun ? "flask" : "zap"} size={20} strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-500">
                Sending mode
                <Info title="Sending mode" size={13} text="DRY-RUN mein approve ki hui mails sirf aapke test address pe jaati hain, taaki aap dekh sako lead ko kya milega. Test address na ho to koi mail nahi jaati. LIVE mein wahi mails asli leads ko jaati hain. Mode kabhi bhi badal sakte ho (LIVE ke liye test address chahiye); LIVE karne ke liye button do baar dabana padta hai." />
              </div>
              <div className={`mt-0.5 text-xl font-bold tracking-tight ${s.dryRun ? "text-amber-700" : "text-emerald-700"}`}>{s.dryRun ? "DRY-RUN" : "LIVE"}</div>
              <p className="mt-1 text-sm text-slate-600">
                {s.dryRun
                  ? s.testEmail
                    ? <>Approve ki hui mails sirf aapke test address <span className="break-all font-medium text-slate-900">{s.testEmail}</span> pe jaati hain. Kisi lead ko kuch nahi jaata.</>
                    : <>{strong("Test address set nahi hai,")} isliye abhi koi mail nahi jaayegi (na lead ko, na aapko). LIVE karne ke liye bhi ye chahiye.</>
                  : <>Approve ki hui mails asli leads ko jaati hain, sirf sending window ({s.windowStart}-{s.windowEnd}, {tz}) mein.</>}
              </p>
              {s.dryRun && !s.testEmail && (
                <Link href="/settings#mailbox" className="btn btn-sm mt-2.5">Test address daalo<Icon name="chevron-right" size={13} /></Link>
              )}
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
                <Icon name={s.approveEach ? "check-check" : "bot"} size={13} className="mt-px" />
                {s.approveEach ? "Har mail pehle aapke approval ke liye rukti hai." : "Auto-approve on hai: naye drafts apne aap approve ho jaate hain."}
              </p>
            </div>
          </div>
          <div className="shrink-0 sm:pl-2">
            {s.dryRun
              ? <ActionButton action={setModeAction.bind(null, true)} className="btn-primary w-full sm:w-auto" icon="zap" label="LIVE karo" confirmText="Dobara dabao: mails asli leads ko jayengi" next="/review" nextCta="Approve page kholo" />
              : <ActionButton action={setModeAction.bind(null, false)} className="btn w-full sm:w-auto" icon="flask" label="Wapas DRY-RUN karo" />}
          </div>
        </div>
      </Section>

      <div className={`grid gap-5 ${wide ? "" : "xl:grid-cols-3"}`}>
        <div className={`min-w-0 ${wide ? "" : "xl:col-span-2"}`}>
          <Heading title="Aaj ka hisaab" info="Aaj ke numbers. 'Aaj' yahan IST ka din hai (raat 12 baje se). Daily limit campaign ke timezone ke din se chalti hai." />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Leads ko gayi" value={liveToday} href="/sent" icon="send" tone="emerald" sub={`Aaj · dry-run test: ${dryToday}`}
              info="Aaj kitni mails asli leads ko successfully gayi. Dry-run ki test mails isme nahi giniti, wo neeche chhoti line mein hain. Click karke Sent page pe har mail ka text dekho." />
            <Stat label="Approval baaki" value={waiting} href="/review" icon="check-check" tone={waiting ? "amber" : "slate"}
              sub={waiting ? "Approve karo, tabhi jayengi" : s.approveEach ? "Abhi koi mail nahi ruki" : "Auto-approve on hai"}
              info={s.approveEach
                ? "AI ki likhi mails jo aapke approval ka wait kar rahi hain. Aapke approve kiye bina koi mail nahi jaati. Click karke Approve page kholo."
                : "Auto-approve on hai: naye drafts apne aap approve hokar bhej diye jaate hain. Yahan sirf wo mails gini jaati hain jo abhi bhi aapke approval ka wait kar rahi hain. Click karke Approve page kholo."} />
            <Stat label="Bheji / limit" value={<>{today}<span className="text-slate-300"> / </span><span className="text-slate-500">{cap}</span></>} icon="trending" tone="indigo"
              sub={<><div className="mb-1.5 mt-1"><Progress value={cap ? today / cap : 0} tone={cap && today >= cap ? "amber" : "indigo"} /></div>Warm-up · max {top}/din{planCaps && " (plan ka 40%)"}</>}
              info="Aaj kitni mails gayi (live + dry-run dono) aur aaj ki limit kitni hai. Naya domain safe rahe isliye limit warm-up se har sending din (jis din live mail gayi) thodi badhti hai, warm-up ke max tak. Plan limit set ho to kabhi plan ke 40% se upar nahi jaati. Din campaign ke timezone se gina jata hai." />
            <Stat label="Agli mail kab" value={stopped ? "Ruki hui" : needApproval ? "Approval ka wait" : next ? when(next) : "—"} icon="clock" tone={stopped ? "red" : needApproval ? "amber" : "sky"}
              sub={needApproval ? "Approve karo, tabhi agli mail jayegi" : `Window ${s.windowStart}-${s.windowEnd} · ${tz}`}
              info="Worker agli mail kab bhejega (IST mein). Mails sirf sending window ke andar jaati hain, jo campaign ke timezone mein hai, aur har mail ke beech kuch minute ka gap rehta hai. Queue khali ho to yahan — dikhta hai. Mails approval ke liye ruki hon aur koi approve ki hui mail ready na ho, to 'Approval ka wait' dikhta hai." />
            <Stat label="Queue" value={queue} icon="list" tone={review ? "amber" : "indigo"} href={review ? "/contacts?status=needs_review" : undefined}
              sub={review ? `${review} review ke liye ruke` : "Chal rahe campaigns ke baaki leads"}
              info="Chal rahe campaigns ke kitne leads ko abhi mail jaani baaki hai. 'Review chahiye' wale leads isme nahi hain; unhe approve karoge tabhi wo queue mein aayenge." />
            <Stat label="Health" value={<span className="inline-flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${h.dot}`} />{h.label}</span>} icon="activity" tone={h.tone}
              href={health !== "green" ? "#issues" : undefined}
              sub={workerAlive ? `Worker chalu · Inbox sync ${when(st.lastSyncAt)}` : "Worker band hai (6 min se signal nahi)"}
              info="System ki sehat ek nazar mein. Hara = sab theek. Peela = kuch dhyan dene layak hai. Laal = sending ruki hai ya DNS mein problem hai. Detail 'Dhyan dene wali baatein' mein hai." />
          </div>
        </div>

        <div id="issues" className="flex min-w-0 scroll-mt-20 flex-col">
          <Heading title="Dhyan dene wali baatein" info="Jo cheezein abhi theek karni hain ya dekhni hain, sabse zaroori sabse upar. Line pe click karke seedha us page pe jao jahan wo theek hoti hai. Laal = zaroori, peela = dhyan do, neela = aapka kaam baaki hai.">
            {problems > 0 && <Badge v="" dot={false} tone={health === "red" ? "red" : "amber"} label={`${problems} ${problems === 1 ? "baat" : "baatein"}`} />}
          </Heading>
          <div className="card-flush flex flex-1 flex-col">
            {problems === 0 && (
              <div className="p-3">
                <Callout tone="success" title="Sab theek chal raha hai">
                  <ul className="mt-1.5 space-y-1">
                    {passed.map((p) => <li key={p} className="flex items-start gap-1.5"><Icon name="check" size={13} strokeWidth={2.4} className="mt-0.5" />{p}</li>)}
                  </ul>
                </Callout>
              </div>
            )}
            {issues.length > 0 && (
              // gap-px over a grey background draws the lines between rows (and between the two columns when wide)
              <ul className={`grid gap-px bg-slate-100 ${wide ? "lg:grid-cols-2 lg:[&>li:last-child:nth-child(odd)]:col-span-2" : ""} ${problems === 0 ? "border-t border-slate-100" : ""}`}>
                {issues.map((i) => <IssueRow key={i.title} i={i} />)}
              </ul>
            )}
            {problems > 0 && passed.length > 0 && (
              <div className="mt-auto border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
                <div className="text-2xs font-bold uppercase tracking-wider text-slate-400">Baaki sab theek</div>
                <ul className={`mt-1.5 ${wide ? "flex flex-wrap gap-x-5 gap-y-1" : "space-y-1"}`}>
                  {passed.map((p) => <li key={p} className="flex items-start gap-1.5 text-xs text-slate-500"><Icon name="check" size={13} strokeWidth={2.4} className="mt-px text-emerald-500" />{p}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <Heading title="Ab tak ka total" info="Shuru se ab tak ke numbers, saare campaigns mila ke. Box pe click karke uska page kholo." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <Stat label="Total bheji" value={sent} href="/sent" icon="mail-check" tone="emerald" sub="Asli leads ko"
            info="Shuru se ab tak kitni mails asli leads ko gayi (bounce wali bhi). Dry-run ki test mails isme nahi hain. Click karke Sent page pe din-ba-din har mail dekho." />
          <Stat label="Reply aaye" value={replied} href="/replies" icon="reply" tone="violet" sub="Leads ke jawab"
            info="Kitne leads ne jawab diya. Click karke Replies (Inbox) mein unke jawab padho. Inbox har 10 minute mein apne aap sync hota hai." />
          <Stat label="Bounce" value={bounced} href="/contacts?status=bounced" icon="alert" tone={bounceRate > 0.02 ? "red" : "slate"} sub={`Last 50: ${bouncePct}%`}
            info="Kitni mails wapas aa gayi (galat ya band address). Last 50 mails mein 2% se zyada bounce ho to list check karo. 5% se upar, ya ek din mein 2 hard bounce pe, sending apne aap ruk jaati hai." />
          <Stat label="Opt-out" value={optedOut} href="/contacts?status=opted_out" icon="ban" tone="orange" sub="Mail band karwai"
            info="Kitne leads ne aage mail na bhejne ko kaha. Ye apne aap Block List mein chale jaate hain aur inhe kabhi mail nahi jaati." />
          {/* fills the last row while the grid has 2 or 3 columns */}
          <div className="col-span-2 xl:col-span-1 [&>*]:h-full">
            <Stat label="Ledger" value={ledger} href="/ledger" icon="shield" tone="indigo" sub="Kabhi dobara mail nahi"
              info="Jin addresses ko kabhi bhi mail gayi hai (ya aapne khud add kiye), unki permanent list. Inme se kisi ko dobara cold mail nahi jaati." />
          </div>
        </div>
      </div>

      <Section
        flush
        title="Active campaigns"
        icon="megaphone"
        info="Jo campaigns chal rahe hain, ruke hue hain ya draft mein hain. Progress batata hai kitne leads ka kaam ho gaya. 'Kab tak khatam' ek andaza hai jo daily limit aur sending window se nikalta hai."
        sub={progress.length ? `${progress.length} campaign · chal rahe, ruke hue aur draft` : undefined}
        actions={<Link href="/campaigns" className="btn-ghost btn-sm"><span className="max-sm:hidden">Saare campaigns</span><span className="sm:hidden">Sab dekho</span><Icon name="arrow-right" size={13} /></Link>}
      >
        {progress.length ? (
          <div className="overflow-x-auto">
            <table className="tbl tbl-stack">
              <thead><tr><th>Naam</th><th>Status</th><th>Progress</th><th className="md:text-right">Baaki</th><th>Kab tak khatam</th></tr></thead>
              <tbody>
                {progress.map(({ c, total, done, remaining, finish }) => (
                  <tr key={c.id}>
                    <td><Link href={`/campaigns/${c.id}`} className="link break-words">{c.name}</Link></td>
                    <td data-label="Status"><Badge v={c.status} /></td>
                    <td data-label="Progress" className="md:w-1/3">
                      <div className="w-36 md:w-full">
                        <Progress value={total ? done / total : 0} />
                        <div className="mt-1 text-xs tabular-nums text-slate-500">{done}/{total} ho gaye</div>
                      </div>
                    </td>
                    <td data-label="Baaki" className="tabular-nums md:text-right">{remaining}</td>
                    <td data-label="Kab tak khatam" className="whitespace-nowrap">{fmtDate(finish)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="megaphone" title="Koi active campaign nahi" text="Import ki hui list se campaign banao. Pehle 5 sample mails banengi, unhe padh ke start karo." href="/campaigns" cta="Campaign banao" />
        )}
      </Section>

      {setupDone === 7 && (
        <details className="card-flush group">
          <summary className="flex cursor-pointer select-none items-center gap-3 px-4 py-3 transition hover:bg-slate-50/70 sm:px-5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><Icon name="check-circle" size={15} /></span>
            <span className="min-w-0 flex-1">
              <span className="h2 block">Setup poora ho gaya (7/7)<Info className="ml-1.5" title="Setup guide" text="Pehli baar ke saare 7 setup kaam ho chuke hain. Kholke dekho kaunsa step kahan hota hai, jaise naya mailbox ya domain lagane pe." /></span>
              <span className="mt-0.5 block text-xs text-slate-500">Saare steps dobara dekhne ke liye kholo</span>
            </span>
            <Icon name="chevron-down" size={16} className="text-slate-400 transition group-open:rotate-180" />
          </summary>
          <div className="border-t border-slate-100"><SetupList steps={setup} current={-1} /></div>
        </details>
      )}

      {manual > 0 && (
        <ToastOnMount kind="warning" title={`${manual} mails ka manual check baaki hai`} text="Pata nahi ye mails gayi ya nahi. Sent folder mein dekh ke har contact pe mark karo."
          href="/contacts?status=check_manual" cta="Check karo" once={`problem:dash-manual:${manual}`} />
      )}
      {bounceRate > 0.02 && (
        <ToastOnMount kind="warning" title={`Bounce rate ${bouncePct}% ho gaya`} text="Last 50 mails mein 2% se zyada bounce. 5% pe sending apne aap ruk jayegi, list check karo."
          href="/contacts?status=bounced" cta="Bounce dekho" once={`problem:dash-bounce:${bouncePct}`} />
      )}
    </div>
  );
}

/** Small group title above a row of tiles. */
function Heading({ title, info, children }: { title: string; info: string; children?: ReactNode }) {
  return (
    <div className="mb-2.5 flex min-h-5 items-center gap-1.5 px-0.5">
      <h2 className="text-2xs font-bold uppercase tracking-wider text-slate-500">{title}</h2>
      <Info text={info} title={title} size={13} />
      {children && <div className="ml-auto">{children}</div>}
    </div>
  );
}

function IssueRow({ i }: { i: Issue }) {
  const look = ISSUE_LOOK[i.tone];
  return (
    <li className="bg-white">
      <Link href={i.href} className="group flex h-full items-start gap-3 px-4 py-3 transition hover:bg-slate-50/80 sm:px-5">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${look.color}`}><Icon name={look.icon} size={14} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-slate-900">{i.title}</span>
          {i.text && <span className="mt-0.5 line-clamp-2 break-words text-xs text-slate-500">{i.text}</span>}
          <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600">
            {i.cta}<Icon name="arrow-right" size={12} className="transition group-hover:translate-x-0.5" />
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The 7 first-time setup steps: tick when done, the current one highlighted, a button to the page where it is done.
 * show picks the open steps or the finished ones (numbers stay those of the full list).
 * guided = the step "Aapka agla step" already shows with its big button: that row gets a plain one, so it is not on screen twice.
 */
function SetupList({ steps, current, guided = -1, show = "all" }: { steps: SetupStep[]; current: number; guided?: number; show?: "all" | "todo" | "done" }) {
  return (
    <ol className="divide-y divide-slate-100">
      {steps.map((x, i) => {
        if ((show === "todo" && x.done) || (show === "done" && !x.done)) return null;
        const cur = i === current;
        const cut = x.title.lastIndexOf(" ") + 1; // keeps the (i) on the line of the last word
        return (
          <li key={x.title} className={`flex items-start gap-3 px-4 py-3 sm:px-5 ${cur ? "bg-indigo-50/50" : ""}`}>
            <span className={`mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full text-2xs font-bold ${x.done ? "bg-emerald-600 text-white" : cur ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/30" : "bg-slate-100 text-slate-500"}`}>
              {x.done ? <Icon name="check" size={12} strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-medium ${x.done ? "text-slate-500" : "text-slate-900"}`}>
                {x.title.slice(0, cut)}
                <span className="whitespace-nowrap">{x.title.slice(cut)}<Info className="ml-1.5" text={x.info} title={x.title} size={13} /></span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{x.how}</p>
              {!x.done && x.now && (
                <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/15">
                  <Icon name="alert" size={12} />{x.now}
                </p>
              )}
            </div>
            <Link href={x.href} className={`${cur && i !== guided ? "btn-primary" : x.done ? "btn-ghost" : "btn"} btn-sm shrink-0`}>
              {x.done ? "Dekho" : x.cta}<Icon name="chevron-right" size={13} className={x.done ? "text-slate-400" : ""} />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
