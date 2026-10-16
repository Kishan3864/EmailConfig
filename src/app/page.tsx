import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { C, count, rows, type Campaign } from "@/lib/fsdb";
import { getSettings, getState } from "@/lib/settings";
import { capFor, priorSendingDays, sentToday, estimateFinish, nextWindowOpen } from "@/lib/schedule";
import { queuedCount } from "@/lib/campaign";
import { fmt, fmtDate, dayStart, partsIn, DISPLAY_TZ } from "@/lib/time";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { Badge, Callout, EmptyState, NextStep, PageHeader, Progress, Section, Stat, type Tone } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { Info } from "@/components/Info";
import { ActionButton } from "@/components/ActionButton";
import { ToastOnMount } from "@/components/toast";
import { globalStopAction, clearStopAction, setModeAction } from "./actions";

// "Dashboard" is the same word in Hinglish and English
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
  green: { label: { hi: "Sab theek", en: "All good" }, dot: "bg-emerald-500", tone: "emerald" },
  amber: { label: { hi: "Dhyan do", en: "Attention" }, dot: "bg-amber-400", tone: "amber" },
  red: { label: { hi: "Problem", en: "Problem" }, dot: "bg-red-500", tone: "red" },
} satisfies Record<string, { label: { hi: string; en: string }; dot: string; tone: Tone }>;

/**
 * Short IST time: "Aaj 14:30" / "Today 14:30", "Kal 09:30" (Hinglish kal = yesterday or tomorrow, the tile makes it clear;
 * English says "Yesterday" or "Tomorrow") or "18 Oct, 09:30".
 */
function when(d: Date | string | null | undefined, t: T) {
  if (!d) return "—";
  const at = new Date(d);
  const day = (x: Date) => partsIn(x, DISPLAY_TZ).dayKey;
  const now = Date.now();
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  if (day(at) === day(new Date(now))) return t(`Aaj ${time}`, `Today ${time}`);
  if (day(at) === day(new Date(now + 864e5))) return t(`Kal ${time}`, `Tomorrow ${time}`);
  if (day(at) === day(new Date(now - 864e5))) return t(`Kal ${time}`, `Yesterday ${time}`);
  return new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

const strong = (x: ReactNode) => <span className="font-semibold text-slate-900">{x}</span>;

export default async function Dashboard() {
  const { t, lang } = await getT();
  const [s, st, active] = await Promise.all([
    getSettings(),
    getState(),
    C.campaigns.where("status", "in", ["running", "paused", "draft"]).get().then((q) => rows<Campaign>(q).sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
  ]);
  const tz = active.find((c) => c.status === "running")?.timezone || active[0]?.timezone || "Europe/Paris";
  // the worker drafts and sends only for campaigns that are running AND started (samplesApproved = started)
  const isLive = (c: Campaign) => c.status === "running" && c.samplesApproved;
  const liveIds = active.filter(isLive).map((c) => c.id);
  const byStatus = (status: string) => count(C.leads.where("status", "==", status));
  const ofCampaign = (id: string) => C.leads.where("campaignId", "==", id);
  const istToday = dayStart(new Date(), DISPLAY_TZ).toISOString();

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  // all reads run in parallel (counts only, a few per running campaign); only the finish estimates further down depend on each other
  // the way of a mail: draft still to make (worker) → Text chahiye → Approval baaki → send queue (approved) → sent
  const [[prior, today, leadsLeft, toCreate, queued, dryDone], [sent, replied, bounced, optedOut, review, manual, ledger], [liveToday, dryToday, waiting, needsText], [confirmedLists, startedCampaigns, okSends], last50, sizes] = await Promise.all([
    Promise.all([
      priorSendingDays(tz), sentToday(tz),
      liveIds.length ? count(C.leads.where("campaignId", "in", liveIds.slice(0, 30)).where("status", "==", "ready")) : 0,
      // Ready leads of running, started campaigns the worker has not made a draft for yet
      Promise.all(liveIds.map((id) => count(ofCampaign(id).where("status", "==", "ready").where("hasMessage", "==", false)))).then(sum),
      // approved mails of running, started campaigns still to go out: only these are ever sent (DRY-RUN: not yet sent to the test address)
      Promise.all(liveIds.map((id) => queuedCount(id, s.dryRun))).then(sum),
      // DRY-RUN: approved mails already sent to the test address; they go to the leads only after LIVE
      s.dryRun ? Promise.all(liveIds.map((id) => count(C.messages.where("campaignId", "==", id).where("status", "==", "ready").where("dryRunDone", "==", true).where("approved", "==", true)))).then(sum) : 0,
    ]),
    Promise.all([
      count(C.messages.where("status", "in", ["sent", "bounced"])), byStatus("replied"), byStatus("bounced"), byStatus("opted_out"), byStatus("needs_review"), byStatus("check_manual"), count(C.contacted),
    ]),
    Promise.all([
      count(C.sendLogs.where("ok", "==", true).where("at", ">=", istToday).where("dryRun", "==", false)),
      count(C.sendLogs.where("ok", "==", true).where("at", ">=", istToday).where("dryRun", "==", true)),
      count(C.messages.where("approved", "==", false).where("status", "==", "ready")),
      count(C.messages.where("status", "==", "needs_text")),
    ]),
    // setup guide (samplesApproved = the campaign was started)
    Promise.all([count(C.lists.where("confirmed", "==", true)), count(C.campaigns.where("samplesApproved", "==", true)), count(C.sendLogs.where("ok", "==", true))]),
    C.messages.orderBy("sentAt", "desc").limit(50).get().then((q) => q.docs.map((d) => d.get("status") as string)),
    // per active campaign: leads, Ready leads, leads to review, drafts awaiting my approval, drafts waiting for my text
    Promise.all(active.map((c) => Promise.all([
      count(ofCampaign(c.id)), count(ofCampaign(c.id).where("status", "==", "ready")), count(ofCampaign(c.id).where("status", "==", "needs_review")),
      count(C.messages.where("campaignId", "==", c.id).where("status", "==", "ready").where("approved", "==", false)),
      count(C.messages.where("campaignId", "==", c.id).where("status", "==", "needs_text")),
    ]))),
  ]);
  // drafts waiting for me, split by whether approving them sends anything: only running, started campaigns send.
  // idle = the waiting drafts of a campaign in draft (not started) or paused: approving them sends nothing yet
  let waitLive = 0, textLive = 0;
  const idle: { c: Campaign; n: number }[] = [];
  active.forEach((c, i) => {
    const [, , , w, x] = sizes[i];
    if (isLive(c)) { waitLive += w; textLive += x; }
    else if (w + x) idle.push({ c, n: w + x });
  });
  const idleN = sum(idle.map((x) => x.n));
  /** The Approve page (k 3 = "Approval baaki", 4 = "Text chahiye" tab), filtered to one campaign when all `total` drafts are its own. */
  const reviewHref = (k: 3 | 4, total: number, liveOnly = false) => {
    const i = active.findIndex((c, j) => sizes[j][k] > 0 && (!liveOnly || isLive(c)));
    const c = i >= 0 && sizes[i][k] === total ? `c=${active[i].id}` : "";
    return k === 4 ? `/review?s=text${c && `&${c}`}` : `/review${c && `?${c}`}`;
  };
  const silent = s.dryRun && !s.testEmail; // DRY-RUN without a test address: no mail goes out at all
  const cap = capFor(s, prior);
  const bounceRate = last50.length ? last50.filter((x) => x === "bounced").length / last50.length : 0;
  const bouncePct = (bounceRate * 100).toFixed(1);
  const workerAlive = !!st.lastWorkerTick && Date.now() - new Date(st.lastWorkerTick).getTime() < 6 * 60000;
  const stopped = st.globalStop || !!st.alert;
  const dnsBad = !!st.dns && (!st.dns.spf || !st.dns.dkim);
  const noAlertTo = !s.alertEmail && !s.testEmail; // alert, reply and daily-report mails then have nobody to go to

  // problems (same checks as always), each with the page where it gets fixed
  const issues: Issue[] = [];
  if (st.alert) issues.push({ tone: "danger", title: t("Sending apne aap ruk gayi (auto-pause)", "Sending was paused automatically"), text: st.alert.message, href: "#top", cta: t("Upar se stop hatao", "Clear the stop above") });
  if (st.globalStop) issues.push({ tone: "danger", title: t("STOP on hai: koi mail nahi jayegi", "STOP is on: no mail will go out"), text: t("Problem theek karke upar se stop hatao.", "Fix the problem, then clear the stop above."), href: "#top", cta: t("Upar jao", "Go to top") });
  if (!workerAlive) issues.push({ tone: "warn", title: t("Worker 6 minute se nahi chala", "Worker has not run for 6 minutes"), text: t("Worker ke bina koi mail nahi jaati. Server pe pm2 status check karo.", "No mail goes out without the worker. Check pm2 status on the server."), href: "/logs", cta: t("Logs dekho", "See logs") });
  if (dnsBad) issues.push({ tone: "danger", title: t("SPF ya DKIM missing hai", "SPF or DKIM is missing"), text: t("Isse mails spam mein jaati hain. DNS theek kiye bina campaign start nahi hoga.", "This sends mails to spam. No campaign can start until DNS is fixed."), href: "/settings", cta: t("Settings kholo", "Open settings") });
  if (!st.dns) issues.push({ tone: "warn", title: t("DNS abhi check nahi hua", "DNS not checked yet"), text: t("Settings mein DNS check chalao (SPF, DKIM, DMARC).", "Run the DNS check in Settings (SPF, DKIM, DMARC)."), href: "/settings", cta: t("Settings kholo", "Open settings") });
  if (noAlertTo) issues.push({ tone: "warn", title: t("Alert mails kahin nahi ja rahi", "Alert mails go nowhere"), text: t("Alert aur Test address khaali hain: auto-pause, reply aur report ki mail nahi aayegi.", "Alert and Test address are empty: you get no auto-pause, reply or report mails."), href: "/settings#mailbox", cta: t("Address daalo", "Add address") });
  if (bounceRate > 0.02) issues.push({ tone: "warn", title: t(`Bounce rate ${bouncePct}% hai`, `Bounce rate is ${bouncePct}%`), text: t("Last 50 mails mein 2% se zyada bounce. 5% pe sending apne aap ruk jayegi.", "Over 2% of the last 50 mails bounced. At 5% sending stops automatically."), href: "/contacts?status=bounced", cta: t("Bounce dekho", "See bounces") });
  if (manual) issues.push({ tone: "warn", title: t(`${manual} mails ka manual check baaki hai`, `${manual} ${manual === 1 ? "mail needs" : "mails need"} a manual check`), text: t("Pata nahi ye mails gayi ya nahi. Sent folder mein dekh ke mark karo.", manual === 1 ? "Unclear if this mail went out. Check your Sent folder and mark it." : "Unclear if these mails went out. Check your Sent folder and mark them."), href: "/contacts?status=check_manual", cta: t("Check karo", "Check them") });
  if (s.dryRun) issues.push({
    tone: "warn", title: t("DRY-RUN mode on hai", "DRY-RUN mode is on"), href: "#mode", cta: t("Mode dekho", "See mode"),
    text: s.testEmail
      ? t("Mails sirf aapke test address pe jaa rahi hain, leads ko kuch nahi jaata.", "Mails only go to your test address; leads get nothing.")
      : t("Test address set nahi hai, isliye abhi koi mail nahi jaa rahi (na lead ko, na aapko).", "No test address is set, so no mail goes out now (not to leads, not to you)."),
  });
  const health = st.alert || st.globalStop || dnsBad ? "red" : issues.length ? "amber" : "green";
  const problems = issues.length;
  // the same checks, listed when they pass, so the panel shows what is being watched
  const tick = when(st.lastWorkerTick, t);
  const passed = [
    !stopped && t("Sending chalu hai, koi stop nahi", "Sending is on, no stop set"),
    workerAlive && t(`Worker chal raha hai (${tick})`, `Worker is running (${tick})`),
    !!st.dns && !dnsBad && t("DNS sahi hai: SPF aur DKIM mile", "DNS is fine: SPF and DKIM found"),
    !noAlertTo && t("Alert aur report mail ka address set hai", "Alert and report mail address is set"),
    bounceRate <= 0.02 && t(`Bounce rate ${bouncePct}% (2% se kam)`, `Bounce rate ${bouncePct}% (under 2%)`),
    !manual && t("Koi manual check baaki nahi", "No manual checks pending"),
    !s.dryRun && t("LIVE mode on hai", "LIVE mode is on"),
  ].filter((x): x is string => !!x);
  // a to-do, not a problem: it does not change the health colour
  if (review) issues.push({ tone: "info", title: t(`${review} leads review ke liye ruke hain`, `${review} ${review === 1 ? "lead is" : "leads are"} waiting for review`), text: t("Approve ya reject karo, tabhi inhe mail jayegi.", "Approve or reject them; until then they get no mail."), href: "/contacts?status=needs_review", cta: t("Review karo", "Review leads") });
  if (needsText) issues.push({
    tone: "info", href: reviewHref(4, needsText), cta: t("Text likho", "Write the text"),
    title: t(`${needsText} mails mein aapka text chahiye`, `${needsText} ${needsText === 1 ? "mail needs" : "mails need"} your text`),
    text: t(
      "Kisi mein [OBSERVATION] jaisi jagah khaali hai, kisi ka text draft ka rule todta hai. Approve page ke 'Text chahiye' tab mein 'Text edit karo' se theek karo, tabhi approve hogi.",
      "Some miss a part like [OBSERVATION], some break a draft rule. Fix them with 'Edit text' in the 'Needs your text' tab of the Approve page; only then can they be approved.",
    ),
  });
  issues.sort((a, b) => ISSUE_LOOK[a.tone].rank - ISSUE_LOOK[b.tone].rank);
  // up to 2 rows fit beside today's tiles (big screens); more get the full width in two columns
  const wide = issues.length > 2;

  // only approved mails are ever sent: the next one leaves from the send queue, in the sending window
  // (DRY-RUN: queued holds only the mails not yet sent to the test address, so nothing left there = no time to promise)
  let next: Date | null = null;
  if (!stopped && !silent && queued > 0) {
    const gap = st.nextSendAt ? new Date(st.nextSendAt) : new Date();
    next = nextWindowOpen(gap > new Date() ? gap : new Date(), s, tz);
  }
  // nothing approved and drafts of running, started campaigns waiting for me: nothing leaves until I approve (the last step).
  // Drafts of a campaign in draft or paused do not count: approving those sends nothing until it is started / resumed
  const needApproval = !stopped && !silent && queued === 0 && waitLive + textLive > 0;
  const idleOnly = waitLive + textLive === 0 && idleN > 0;
  const top = capFor(s, 1000); // the most the daily limit ever grows to (the same number Settings shows)
  const planCaps = s.planDailyLimit > 0 && top === Math.floor(s.planDailyLimit * 0.4); // the plan's 40%, not the warm-up, sets that maximum

  // finish estimates (if I keep approving): mails of running, started campaigns created earlier go out first ("ahead")
  let ahead = 0;
  const progress = await Promise.all(active.map((c, i) => {
    const [total, remaining, rev, toApprove, toText] = sizes[i];
    const before = ahead;
    if (isLive(c)) ahead += remaining;
    return estimateFinish(s, c.timezone, remaining, before).then((finish) => ({ c, total, done: total - remaining - rev, remaining, toApprove, toText, finish }));
  }));

  const emptyFields = [!s.fromEmail && "From address", !s.testEmail && "Test address", !s.senderName && t("Naam", "Name"), !s.postalAddress && "Postal address"].filter(Boolean).join(", ");
  const dnsMissing = [!st.dns?.spf && "SPF", !st.dns?.dkim && "DKIM"].filter(Boolean);
  const setup: SetupStep[] = [
    {
      title: t("Settings bharo", "Fill in Settings"), done: !!(s.fromEmail && s.testEmail && s.senderName && s.postalAddress), href: "/settings", cta: t("Settings kholo", "Open settings"),
      how: t("From address, test address, apna naam aur postal address daalo.", "Enter the From address, test address, your name and postal address."),
      now: emptyFields && t(`Abhi khaali: ${emptyFields}`, `Still empty: ${emptyFields}`),
      info: t(
        "Settings page pe Mailbox aur Sender profile bharo. From address se mails jaati hain, test address pe dry-run ki test mails aati hain. Postal address har mail ke footer mein jaata hai. SMTP password server ki .env file mein rehta hai.",
        "Fill in Mailbox and Sender profile on the Settings page. Mails are sent from the From address; dry-run test mails arrive at the test address. The postal address goes into the footer of every mail. The SMTP password lives in the server's .env file.",
      ),
    },
    {
      title: t("Test mail bhejo aur DNS check karo", "Send a test mail and check DNS"), done: !!(st.dns?.spf && st.dns?.dkim), href: "/settings", cta: t("Settings kholo", "Open settings"),
      how: t("Settings se khud ko test mail bhejo, phir DNS check chalao. SPF aur DKIM dono sahi hone chahiye.", "Send yourself a test mail from Settings, then run the DNS check. SPF and DKIM must both pass."),
      now: !st.dns
        ? t("DNS abhi check nahi hua", "DNS not checked yet")
        : t(`${dnsMissing.join(" aur ")} missing hai`, `${dnsMissing.join(" and ")} ${dnsMissing.length > 1 ? "are" : "is"} missing`),
      info: t(
        "Test mail se pata chalta hai ki SMTP sahi set hai. DNS check aapke domain ke SPF, DKIM aur DMARC record padhta hai. SPF ya DKIM na ho to mails spam mein jaati hain, isliye bina inke campaign start nahi hota.",
        "The test mail shows whether SMTP is set up correctly. The DNS check reads your domain's SPF, DKIM and DMARC records. Without SPF or DKIM mails land in spam, so no campaign starts without them.",
      ),
    },
    {
      title: t("Purane contacts Ledger mein daalo", "Add past contacts to the Ledger"), done: ledger > 0, href: "/ledger", cta: t("Ledger kholo", "Open ledger"),
      how: t("Jinko aap pehle mail kar chuke ho, unhe Ledger mein daalo.", "Add everyone you have already emailed to the Ledger."),
      info: t(
        "Ledger mein jo address hai use ye app kabhi cold mail nahi bhejta. Mailbox ke Sent folder se saare purane addresses ek click mein import karo, ya ek-ek karke add karo.",
        "The app never sends a cold mail to an address in the Ledger. Import all past addresses from your mailbox's Sent folder in one click, or add them one by one.",
      ),
    },
    {
      title: t("Leads ki list import karo", "Import a list of leads"), done: confirmedLists > 0, href: "/import", cta: t("Import karo", "Import leads"),
      how: t("CSV, Excel, PDF ya text se leads upload karo aur list confirm karo.", "Upload leads from CSV, Excel, PDF or text and confirm the list."),
      info: t(
        "Import page pe file daalo, columns match karo aur preview dekho. Galat, duplicate aur pehle contact hue address apne aap hat jaate hain. Confirm karne ke baad hi list campaign mein use hoti hai.",
        "Add a file on the Import page, match the columns and check the preview. Invalid, duplicate and already-contacted addresses are removed automatically. A list can be used in a campaign only after you confirm it.",
      ),
    },
    {
      title: t("Campaign banao aur start karo", "Create a campaign and start it"), done: startedCampaigns > 0, href: "/campaigns", cta: t("Campaign banao", "Create campaign"),
      how: t("List aur mail ka tarika chuno, chaho to 5 samples dekho, phir start karo. Start se koi mail approve nahi hoti.", "Pick a list and how mails are written, look at 5 samples if you like, then start. Starting approves no mail."),
      info: t(
        "Campaigns page pe import ki hui list chuno aur mail ka tarika: AI, ek Template, ya Website ke hisaab se templates. 5 sample drafts sirf ek preview hain (optional). Start karte hi worker campaign ke har Ready lead ka draft banata hai (template se har minute 50 tak, AI se 3) aur sab Approve page pe aate hain: 'Approval baaki' mein, ya 'Text chahiye' mein jab pehle aapka text chahiye. Start khud kuch approve nahi karta, samples bhi nahi.",
        "Pick an imported list on the Campaigns page and how mails are written: AI, one Template, or Templates by website. The 5 sample drafts are only a preview (optional). Once you start, the worker makes a draft for every Ready lead of the campaign (up to 50 a minute from a template, 3 with the AI) and they all show up on the Approve page: as 'Awaiting approval', or as 'Needs your text' when your text is needed first. Starting approves nothing itself, not even the samples.",
      ),
    },
    {
      title: t("Mails approve karo, pehli mail jaane do", "Approve mails and let the first one go"), done: okSends > 0, href: "/review", cta: t("Approve karo", "Approve mails"),
      how: t("Approve page pe drafts padho aur approve karo: ye aakhri step hai. Approve ki hui mail worker apne aap bhejta hai.", "Read the drafts on the Approve page and approve them: this is the last step. The worker sends approved mails by itself."),
      now: idleOnly ? t("Drafts ka campaign abhi nahi chal raha: pehle start / resume karo", "The drafts' campaign is not running: start or resume it first") : undefined,
      info: t(
        "Har draft (samples bhi) Approve page pe aapke Approve ka wait karta hai. Padho, zarurat ho to edit karo, phir ek mail, chuni hui mails ya saari ek saath approve karo. Approve ki hui mail sending window, random gap, daily limit aur plan ke 40% ke andar apne aap jaati hai, par sirf tab jab uska campaign start ho chuka ho aur chal raha ho. Pehli mail (dry-run ki test mail bhi) successfully jaate hi ye step poora ho jata hai.",
        "Every draft (the samples too) waits on the Approve page for your Approve. Read it, edit it if needed, then approve one mail, the ones you select, or all at once. An approved mail goes out by itself within the sending window, a random gap, the daily limit and 40% of the plan, but only while its campaign is started and running. This step is done as soon as the first mail (a dry-run test mail counts too) goes out successfully.",
      ),
    },
    {
      title: t("Sab theek lage to LIVE mode on karo", "Turn on LIVE mode when all looks good"), done: !s.dryRun, href: "/#mode", cta: t("Mode pe jao", "Go to mode"),
      how: t("Dry-run ki test mails sahi lagein to Sending mode mein LIVE karo.", "If the dry-run test mails look right, switch Sending mode to LIVE."),
      info: t(
        "Dry-run mein mails sirf aapke test address pe jaati hain. LIVE karne ke baad approve ki hui mails asli leads ko jaane lagti hain. Kabhi bhi wapas DRY-RUN kar sakte ho.",
        "In dry-run, mails only go to your test address. Once you go LIVE, approved mails start going to real leads. You can switch back to DRY-RUN at any time.",
      ),
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
    if (stopped) return {
      tone: "amber", href: "/logs", cta: t("Logs dekho", "See logs"),
      text: t(<>{strong("Sending ruki hui hai.")} Pehle problem theek karo, phir upar se stop hatao.</>, <>{strong("Sending is stopped.")} Fix the problem first, then clear the stop above.</>),
    };
    // the open step is "Mails approve karo" (index 5) but every waiting draft is in a campaign that does not send: say that instead
    if (openStep && okSends === 0 && !(todo === 5 && idleOnly)) return openStep;
    // only drafts of running, started campaigns: approving them really is the last step
    if (waitLive > 0) return {
      href: reviewHref(3, waitLive, true), cta: t("Approve karo", "Approve mails"),
      text: t(
        <>{strong(`${waitLive} mails aapke approval ka wait kar rahi hain.`)} Padho aur approve karo: ye aakhri step hai, uske baad mail limits ke andar apne aap jaati hai{s.dryRun && " (DRY-RUN mein sirf aapke test address pe)"}.{textLive > 0 && ` ${textLive} mails mein pehle aapka text chahiye.`}{idleN > 0 && ` ${idleN} aur drafts aise campaigns ke hain jo abhi nahi chal rahe: unhe approve karne se abhi kuch nahi jaata.`}</>,
        <>{strong(`${waitLive} ${waitLive === 1 ? "mail is" : "mails are"} waiting for your approval.`)} {waitLive === 1 ? "Read and approve it" : "Read and approve them"}: this is the last step, after which mails go out by themselves within the limits{s.dryRun && " (in DRY-RUN only to your test address)"}.{textLive > 0 && ` ${textLive} ${textLive === 1 ? "mail needs" : "mails need"} your text first.`}{idleN > 0 && ` ${idleN} more ${idleN === 1 ? "draft belongs" : "drafts belong"} to campaigns that are not running: approving ${idleN === 1 ? "it" : "them"} sends nothing yet.`}</>,
      ),
    };
    if (textLive > 0) return {
      href: reviewHref(4, textLive, true), cta: t("Text likho", "Write the text"),
      text: t(
        <>{strong(`${textLive} mails mein aapka text chahiye.`)} Approve page ke ‘Text chahiye’ tab mein ‘Text edit karo’ dabao: [OBSERVATION] jaisi khaali jagah likho ya toota hua rule theek karo, save karo, phir approve karo.</>,
        <>{strong(`${textLive} ${textLive === 1 ? "mail needs" : "mails need"} your text.`)} In the ‘Needs your text’ tab of the Approve page, press ‘Edit text’: write the missing part (like [OBSERVATION]) or fix the broken rule, save, then approve.</>,
      ),
    };
    // drafts wait only in campaigns that are in draft (not started) or paused: approving them sends nothing yet
    if (idleN > 0) {
      const one = idle.length === 1 ? idle[0].c : null;
      const paused = one?.status === "paused";
      return {
        tone: "amber", href: one ? `/campaigns/${one.id}` : "/campaigns", cta: one ? t("Campaign kholo", "Open campaign") : t("Campaigns kholo", "Open campaigns"),
        text: one
          ? t(
            <>{strong(`${idleN} drafts approval ka wait kar rahe hain, par campaign "${one.name}" ${paused ? "ruka hua hai" : "abhi start nahi hua"}.`)} Inhe approve karne se koi mail nahi jaayegi jab tak aap campaign {paused ? "resume" : "start"} nahi karte. Start ya resume khud kuch approve nahi karta.</>,
            <>{strong(`${idleN} ${idleN === 1 ? "draft is" : "drafts are"} waiting for approval, but the campaign "${one.name}" ${paused ? "is paused" : "has not been started"}.`)} Approving {idleN === 1 ? "it" : "them"} sends nothing until you {paused ? "resume" : "start"} the campaign. Starting or resuming approves nothing itself.</>,
          )
          : t(
            <>{strong(`${idleN} drafts approval ka wait kar rahe hain, par unke ${idle.length} campaigns abhi nahi chal rahe (draft ya ruke hue).`)} Inhe approve karne se koi mail nahi jaayegi jab tak campaign start ya resume nahi hota. Start ya resume khud kuch approve nahi karta.</>,
            <>{strong(`${idleN} drafts are waiting for approval, but their ${idle.length} campaigns are not running (draft or paused).`)} Approving them sends nothing until a campaign is started or resumed. Starting or resuming approves nothing itself.</>,
          ),
      };
    }
    if (manual > 0) return {
      tone: "amber", href: "/contacts?status=check_manual", cta: t("Check karo", "Check them"),
      text: t(
        <>{strong(`${manual} mails ka manual check baaki hai.`)} Sent folder mein dekho ki mail gayi ya nahi, phir contact pe mark karo.</>,
        <>{strong(`${manual} ${manual === 1 ? "mail needs" : "mails need"} a manual check.`)} Check your Sent folder to see whether the mail went out, then mark it on the contact.</>,
      ),
    };
    if (review > 0) return {
      href: "/contacts?status=needs_review", cta: t("Review karo", "Review leads"),
      text: t(
        <>{strong(`${review} leads review ke liye ruke hain.`)} Approve ya reject karo, tabhi campaign aage badhega.</>,
        <>{strong(`${review} ${review === 1 ? "lead is" : "leads are"} waiting for review.`)} Approve or reject them so the campaign can move on.</>,
      ),
    };
    if (openStep) return openStep;
    if (!liveIds.length) return {
      href: "/campaigns", cta: t("Campaigns kholo", "Open campaigns"),
      text: t(<>{strong("Abhi koi campaign nahi chal raha.")} Campaign banao aur start karo, ya ruka hua campaign resume karo.</>, <>{strong("No campaign is running right now.")} Create a campaign and start it, or resume a paused one.</>),
    };
    if (leadsLeft === 0) return {
      href: "/import", cta: t("Nayi list import karo", "Import a new list"),
      text: t(<>{strong("Chal rahe campaigns mein koi lead baaki nahi.")} Aur mails bhejne ke liye nayi list import karo.</>, <>{strong("No leads left in the running campaigns.")} Import a new list to send more mails.</>),
    };
    if (queued === 0 && toCreate > 0) return {
      href: "/campaigns", cta: t("Campaigns dekho", "See campaigns"),
      text: t(
        <>{strong(`Worker drafts bana raha hai: ${toCreate} leads ke abhi baaki.`)} Bante hi wo Approve page pe ‘Approval baaki’ mein aayenge.</>,
        <>{strong(`The worker is making drafts: ${toCreate} ${toCreate === 1 ? "lead" : "leads"} still to go.`)} As they are made, they show up on the Approve page as ‘Awaiting approval’.</>,
      ),
    };
    return {
      tone: "emerald", href: "/sent", cta: t("Aaj ki mails dekho", "See today's mails"),
      text: t(
        <>{strong("Sab chal raha hai.")} Worker aapki approve ki hui mails sending window mein apne aap bhej raha hai.</>,
        <>{strong("Everything is running.")} The worker is sending the mails you approved by itself, in the sending window.</>,
      ),
    };
  })();

  const clearStop = (
    <ActionButton action={clearStopAction} icon="check-circle" label={t("Stop / alert hatao", "Clear stop / alert")}
      confirmText={t("Dobara dabao: problem theek kar di hai", "Click again: I fixed the cause")} next="/campaigns" nextCta={t("Campaigns kholo", "Open campaigns")} />
  );
  const h = HEALTH[health];

  return (
    <div className="space-y-5">
      {st.alert && (
        <Callout tone="danger" title={t("Sending apne aap ruk gayi (auto-pause)", "Sending was paused automatically")} action={clearStop}>
          <span className="break-words">{st.alert.message}</span> · {fmt(st.alert.at)}
        </Callout>
      )}

      <PageHeader
        title="Dashboard"
        info={t(
          "Ye aapka control room hai: aaj kitni mails gayi, kitni approval ke liye ruki hain, agla step kya hai aur kahin koi problem to nahi. Emergency mein 'Saari sending roko' dabao, sab turant ruk jayega. Har box ke (i) mein uski jaankari hai.",
          "This is your control room: how many mails went out today, how many wait for approval, what the next step is and whether anything is wrong. In an emergency, press 'Stop all sending' and everything stops at once. Each box's (i) explains that box.",
        )}
        sub={t("Aaj ka haal · Sab samay IST (Asia/Kolkata) mein", "Today at a glance · All times in IST (Asia/Kolkata)")}
        actions={stopped
          ? !st.alert && clearStop /* with an alert the button sits in the red box above */
          : <ActionButton action={globalStopAction} className="btn-danger" icon="stop" label={t("Saari sending roko", "Stop all sending")} />}
      />

      <NextStep title={t("Aapka agla step", "Your next step")} {...guide} />

      {setupDone < 7 && (
        <Section
          flush
          title="Setup guide"
          icon="flag"
          info={t(
            "Pehli baar app chalane ke liye ye 7 kaam isi order mein karo. Har step ke saamne wale button se seedha us page pe jao. Kaam hote hi yahan hara tick lag jata hai.",
            "To run the app for the first time, do these 7 steps in this order. The button next to each step takes you straight to its page. A green tick appears here as soon as a step is done.",
          )}
          sub={t("Pehli baar ye 7 kaam isi order mein karo", "Do these 7 steps in this order the first time")}
          actions={
            <div className="flex items-center gap-2">
              <div className="w-20 sm:w-28"><Progress value={setupDone / 7} /></div>
              <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-slate-600">{t(`${setupDone}/7 poore`, `${setupDone}/7 done`)}</span>
            </div>
          }
        >
          <SetupList steps={setup} current={todo} guided={guideStep} show="todo" t={t} />
          {setupDone > 0 && (
            <details className="group/done border-t border-slate-100">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50/70 hover:text-slate-700 sm:px-5">
                <Icon name="check-circle" size={14} className="text-emerald-500" />
                {t(`${setupDone} ${setupDone === 1 ? "kaam ho gaya" : "kaam ho gaye"}`, `${setupDone} ${setupDone === 1 ? "step done" : "steps done"}`)}
                <span className="text-slate-400">· {t("dekhne ke liye kholo", "open to view")}</span>
                <Icon name="chevron-down" size={14} className="ml-auto text-slate-400 transition group-open/done:rotate-180" />
              </summary>
              <div className="border-t border-slate-100"><SetupList steps={setup} current={-1} show="done" t={t} /></div>
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
                <Info title="Sending mode" size={13} text={t(
                  "DRY-RUN mein approve ki hui mails sirf aapke test address pe jaati hain, taaki aap dekh sako lead ko kya milega. Test address na ho to koi mail nahi jaati. LIVE mein wahi mails asli leads ko jaati hain. Mode kabhi bhi badal sakte ho (LIVE ke liye test address chahiye); LIVE karne ke liye button do baar dabana padta hai.",
                  "In DRY-RUN, approved mails only go to your test address, so you can see what a lead would get. Without a test address no mail goes out. In LIVE the same mails go to real leads. You can change the mode at any time (LIVE needs a test address); going LIVE takes two clicks on the button.",
                )} />
              </div>
              <div className={`mt-0.5 text-xl font-bold tracking-tight ${s.dryRun ? "text-amber-700" : "text-emerald-700"}`}>{s.dryRun ? "DRY-RUN" : "LIVE"}</div>
              <p className="mt-1 text-sm text-slate-600">
                {s.dryRun
                  ? s.testEmail
                    ? t(
                      <>Approve ki hui mails sirf aapke test address <span className="break-all font-medium text-slate-900">{s.testEmail}</span> pe jaati hain. Kisi lead ko kuch nahi jaata.</>,
                      <>Approved mails only go to your test address <span className="break-all font-medium text-slate-900">{s.testEmail}</span>. No lead gets anything.</>,
                    )
                    : t(
                      <>{strong("Test address set nahi hai,")} isliye abhi koi mail nahi jaayegi (na lead ko, na aapko). LIVE karne ke liye bhi ye chahiye.</>,
                      <>{strong("No test address is set,")} so no mail goes out right now (not to leads, not to you). Going LIVE needs it too.</>,
                    )
                  : t(
                    <>Approve ki hui mails asli leads ko jaati hain, sirf sending window ({s.windowStart}-{s.windowEnd}, {tz}) mein.</>,
                    <>Approved mails go to real leads, only inside the sending window ({s.windowStart}-{s.windowEnd}, {tz}).</>,
                  )}
              </p>
              {s.dryRun && !s.testEmail && (
                <Link href="/settings#mailbox" className="btn btn-sm mt-2.5">{t("Test address daalo", "Add test address")}<Icon name="chevron-right" size={13} /></Link>
              )}
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
                <Icon name="check-check" size={13} className="mt-px shrink-0" />
                <span className="min-w-0">{t(
                  "Har mail aapke Approve ka wait karti hai (aakhri step). Approve hote hi wo limits ke andar apne aap jaati hai.",
                  "Every mail waits for your Approve (the last step). Once approved, it goes out by itself within the limits.",
                )}</span>
              </p>
            </div>
          </div>
          <div className="shrink-0 sm:pl-2">
            {s.dryRun
              ? <ActionButton action={setModeAction.bind(null, true)} className="btn-primary w-full sm:w-auto" icon="zap" label={t("LIVE karo", "Go LIVE")}
                  confirmText={t("Dobara dabao: mails asli leads ko jayengi", "Click again: mails will go to real leads")} next="/review" nextCta={t("Approve page kholo", "Open Approve page")} />
              : <ActionButton action={setModeAction.bind(null, false)} className="btn w-full sm:w-auto" icon="flask" label={t("Wapas DRY-RUN karo", "Back to DRY-RUN")} />}
          </div>
        </div>
      </Section>

      <div className={`grid gap-5 ${wide ? "" : "xl:grid-cols-3"}`}>
        <div className={`min-w-0 ${wide ? "" : "xl:col-span-2"}`}>
          <Heading title={t("Aaj ka hisaab", "Today's numbers")} info={t(
            "Aaj ke numbers. 'Aaj' yahan IST ka din hai (raat 12 baje se). Daily limit campaign ke timezone ke din se chalti hai.",
            "Today's numbers. 'Today' here is the IST day (from midnight). The daily limit follows the day in the campaign's timezone.",
          )} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label={t("Leads ko gayi", "Sent to leads")} value={liveToday} href="/sent" icon="send" tone="emerald" sub={t(`Aaj · dry-run test: ${dryToday}`, `Today · dry-run tests: ${dryToday}`)}
              info={t(
                "Aaj kitni mails asli leads ko successfully gayi. Dry-run ki test mails isme nahi gini jaati, wo neeche chhoti line mein hain. Click karke Sent page pe har mail ka text dekho.",
                "How many mails went out to real leads today. Dry-run test mails are not counted here; they are in the small line below. Click to see the text of every mail on the Sent page.",
              )} />
            <Stat label={t("Approval baaki", "Awaiting approval")} value={waiting} href="/review" icon="check-check" tone={waiting || needsText ? "amber" : "slate"}
              sub={needsText
                ? t(`+ ${needsText} mein aapka text chahiye`, `+ ${needsText} ${needsText === 1 ? "needs" : "need"} your text`)
                : waiting ? t("Approve karo, tabhi jayengi", "Sent only after you approve") : t("Abhi koi mail nahi ruki", "No mail waiting right now")}
              info={t(
                "Saare campaigns ke drafts jo aapke Approve ka wait kar rahi hain (AI, template ya lead ke apne text se bani). Approve karna aakhri step hai: aapke click ke bina koi mail approve nahi hoti, campaign Start se bhi nahi. Draft ya ruke hue campaign ke drafts bhi yahan gine jaate hain, par wo campaign start / resume hone ke baad hi jaate hain. 'Text chahiye' wali mails mein pehle [OBSERVATION] jaisi jagah likhni hai ya toota hua rule theek karna hai. Click karke Approve page kholo.",
                "Drafts of all campaigns waiting for your Approve (made by the AI, from a template or from the lead's own text). Approving is the last step: no mail is approved without your click, not even by starting a campaign. Drafts of a campaign in draft or paused count here too, but they go out only once that campaign is started / resumed. Mails marked 'Needs your text' first need you to write a part like [OBSERVATION] or fix a broken rule. Click to open the Approve page.",
              )} />
            <Stat label={t("Bheji / limit", "Sent / limit")} value={<>{today}<span className="text-slate-300"> / </span><span className="text-slate-500">{cap}</span></>} icon="trending" tone="indigo"
              sub={<><div className="mb-1.5 mt-1"><Progress value={cap ? today / cap : 0} tone={cap && today >= cap ? "amber" : "indigo"} /></div>{t(`Warm-up · max ${top}/din${planCaps ? " (plan ka 40%)" : ""}`, `Warm-up · max ${top}/day${planCaps ? " (40% of plan)" : ""}`)}</>}
              info={t(
                "Aaj kitni mails gayi (live + dry-run dono) aur aaj ki limit kitni hai. Naya domain safe rahe isliye limit warm-up se har sending din (jis din live mail gayi) thodi badhti hai, warm-up ke max tak. Plan limit set ho to kabhi plan ke 40% se upar nahi jaati. Din campaign ke timezone se gina jata hai.",
                "How many mails went out today (live and dry-run) and what today's limit is. To keep a new domain safe, warm-up raises the limit a little on every sending day (a day a live mail went out), up to the warm-up max. With a plan limit set, it never goes above 40% of the plan. The day is counted in the campaign's timezone.",
              )} />
            <Stat label={t("Agli mail kab", "Next mail")} value={stopped ? t("Ruki hui", "Stopped") : needApproval ? t("Approval ka wait", "Awaiting approval") : next ? when(next, t) : "—"} icon="clock" tone={stopped ? "red" : needApproval ? "amber" : "sky"}
              sub={needApproval ? t("Approve karo, tabhi agli mail jayegi", "The next mail goes once you approve")
                : !stopped && !next && silent ? t("Test address nahi: koi mail nahi jaati", "No test address: no mail goes out")
                : !stopped && !next && s.dryRun && dryDone > 0 ? t("Test mails ja chuki · leads ko LIVE ke baad", "Test mails sent · leads get them after LIVE")
                : !stopped && !next && idleOnly ? t("Drafts ka campaign chal nahi raha", "The drafts' campaign is not running")
                : `Window ${s.windowStart}-${s.windowEnd} · ${tz}`}
              info={t(
                "Worker agli mail kab bhejega (IST mein). Sirf chal rahe (start kiye) campaigns ki approve ki hui mails jaati hain: sending window ke andar (campaign ke timezone mein), har mail ke beech kuch minute ka random gap. Send queue khaali ho to yahan — dikhta hai; DRY-RUN mein jo mails test address pe ja chuki, wo LIVE ke baad hi leads ko jaati hain. Mails approval ke liye ruki hon aur koi approve ki hui mail baaki na ho, to 'Approval ka wait' dikhta hai.",
                "When the worker sends the next mail (in IST). Only approved mails of running (started) campaigns go out: inside the sending window (in the campaign's timezone), with a random gap of a few minutes between mails. With an empty send queue this shows —; in DRY-RUN, mails already sent to the test address go to the leads only after LIVE. If mails wait for approval and no approved mail is left, it shows 'Awaiting approval'.",
              )} />
            <Stat label="Send queue" value={queued} icon="list" tone="indigo" href={liveIds.length ? "/campaigns" : undefined}
              sub={toCreate
                ? t(`${toCreate} leads ke drafts abhi banne baaki`, `${toCreate} ${toCreate === 1 ? "draft" : "drafts"} still to be made`)
                : s.dryRun
                  ? dryDone
                    ? t(`${dryDone} test pe ja chuki · LIVE ke baad leads ko`, `${dryDone} sent as tests · to leads after LIVE`)
                    : t("Approve ho chuki, test address pe jayengi", "Approved, they go to your test address")
                  : t("Approve ho chuki, apne aap jayengi", "Approved, they go out by themselves")}
              info={t(
                "Chal rahe (start kiye) campaigns ki wo mails jo aap approve kar chuke ho aur jo abhi jaani baaki hain. Worker inhe sending window, random gap, daily limit aur plan ke 40% ke andar ek-ek karke apne aap bhejta hai. DRY-RUN mein sirf wo gini jaati hain jo abhi test address pe nahi gayi. Neeche ki line: kitne Ready leads ka draft worker ne abhi banana hai (template se har minute 50 tak, AI se 3).",
                "Mails of running (started) campaigns that you have approved and that still have to go out. The worker sends them one by one by itself, within the sending window, a random gap, the daily limit and 40% of the plan. In DRY-RUN only those not yet sent to the test address count. The line below: how many Ready leads the worker still has to make a draft for (up to 50 a minute from a template, 3 with the AI).",
              )} />
            <Stat label="Health" value={<span className="inline-flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${h.dot}`} />{h.label[lang]}</span>} icon="activity" tone={h.tone}
              href={health !== "green" ? "#issues" : undefined}
              // English day words are longer ("Yesterday 20:16"): non-breaking spaces keep the day and the time on one line
              sub={workerAlive ? t(`Worker chalu · Inbox sync ${when(st.lastSyncAt, t)}`, `Worker on · Inbox sync ${when(st.lastSyncAt, t).replace(/ /g, " ")}`) : t("Worker band hai (6 min se signal nahi)", "Worker is down (no signal for 6 min)")}
              info={t(
                "System ki sehat ek nazar mein. Hara = sab theek. Peela = kuch dhyan dene layak hai. Laal = sending ruki hai ya DNS mein problem hai. Detail 'Dhyan dene wali baatein' mein hai.",
                "System health at a glance. Green = all good. Yellow = something needs attention. Red = sending is stopped or DNS has a problem. Details are under 'Needs attention'.",
              )} />
          </div>
        </div>

        <div id="issues" className="flex min-w-0 scroll-mt-20 flex-col">
          <Heading title={t("Dhyan dene wali baatein", "Needs attention")} info={t(
            "Jo cheezein abhi theek karni hain ya dekhni hain, sabse zaroori sabse upar. Line pe click karke seedha us page pe jao jahan wo theek hoti hai. Laal = zaroori, peela = dhyan do, neela = aapka kaam baaki hai.",
            "Things to fix or check now, most urgent first. Click a line to go straight to the page where it gets fixed. Red = urgent, yellow = needs attention, blue = a task waiting for you.",
          )}>
            {problems > 0 && <Badge v="" dot={false} tone={health === "red" ? "red" : "amber"} label={t(`${problems} ${problems === 1 ? "baat" : "baatein"}`, `${problems} ${problems === 1 ? "issue" : "issues"}`)} />}
          </Heading>
          <div className="card-flush flex flex-1 flex-col">
            {problems === 0 && (
              <div className="p-3">
                <Callout tone="success" title={t("Sab theek chal raha hai", "Everything is running fine")}>
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
                <div className="text-2xs font-bold uppercase tracking-wider text-slate-400">{t("Baaki sab theek", "Everything else is fine")}</div>
                <ul className={`mt-1.5 ${wide ? "flex flex-wrap gap-x-5 gap-y-1" : "space-y-1"}`}>
                  {passed.map((p) => <li key={p} className="flex items-start gap-1.5 text-xs text-slate-500"><Icon name="check" size={13} strokeWidth={2.4} className="mt-px text-emerald-500" />{p}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <Heading title={t("Ab tak ka total", "All-time totals")} info={t(
          "Shuru se ab tak ke numbers, saare campaigns mila ke. Box pe click karke uska page kholo.",
          "Numbers since the start, all campaigns combined. Click a box to open its page.",
        )} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <Stat label={t("Total bheji", "Total sent")} value={sent} href="/sent" icon="mail-check" tone="emerald" sub={t("Asli leads ko", "To real leads")}
            info={t(
              "Shuru se ab tak kitni mails asli leads ko gayi (bounce wali bhi). Dry-run ki test mails isme nahi hain. Click karke Sent page pe din-ba-din har mail dekho.",
              "How many mails went to real leads since the start (bounced ones included). Dry-run test mails are not counted. Click to see every mail, day by day, on the Sent page.",
            )} />
          <Stat label={t("Reply aaye", "Replies")} value={replied} href="/replies" icon="reply" tone="violet" sub={t("Leads ke jawab", "Answers from leads")}
            info={t(
              "Kitne leads ne jawab diya. Click karke Replies (Inbox) mein unke jawab padho. Inbox har 10 minute mein apne aap sync hota hai.",
              "How many leads replied. Click to read their replies in Replies (Inbox). The inbox syncs automatically every 10 minutes.",
            )} />
          <Stat label={t("Bounce", "Bounced")} value={bounced} href="/contacts?status=bounced" icon="alert" tone={bounceRate > 0.02 ? "red" : "slate"} sub={`Last 50: ${bouncePct}%`}
            info={t(
              "Kitni mails wapas aa gayi (galat ya band address). Last 50 mails mein 2% se zyada bounce ho to list check karo. 5% se upar, ya ek din mein 2 hard bounce pe, sending apne aap ruk jaati hai.",
              "How many mails came back (wrong or closed address). If more than 2% of the last 50 mails bounce, check your list. Above 5%, or at 2 hard bounces in one day, sending stops automatically.",
            )} />
          <Stat label={t("Opt-out", "Opted out")} value={optedOut} href="/contacts?status=opted_out" icon="ban" tone="orange" sub={t("Mail band karwai", "Asked to stop mails")}
            info={t(
              "Kitne leads ne aage mail na bhejne ko kaha. Ye apne aap Block List mein chale jaate hain aur inhe kabhi mail nahi jaati.",
              "How many leads asked not to be mailed again. They go to the Block list automatically and never get a mail.",
            )} />
          {/* fills the last row while the grid has 2 or 3 columns */}
          <div className="col-span-2 xl:col-span-1 [&>*]:h-full">
            <Stat label="Ledger" value={ledger} href="/ledger" icon="shield" tone="indigo" sub={t("Kabhi dobara mail nahi", "Never mailed again")}
              info={t(
                "Jin addresses ko kabhi bhi mail gayi hai (ya aapne khud add kiye), unki permanent list. Inme se kisi ko dobara cold mail nahi jaati.",
                "The permanent list of every address that was ever mailed (or that you added yourself). None of them ever gets a cold mail again.",
              )} />
          </div>
        </div>
      </div>

      <Section
        flush
        title="Active campaigns"
        icon="megaphone"
        info={t(
          "Jo campaigns chal rahe hain, ruke hue hain ya draft mein hain. Progress batata hai kitne leads ka kaam ho gaya. 'Approval baaki' = kitne drafts aapke Approve ka wait kar rahe hain (aur kitno mein pehle aapka text chahiye); draft ya ruke hue campaign ke drafts start / resume ke baad hi jaate hain. 'Kab tak khatam' ek andaza hai jo daily limit aur sending window se nikalta hai, agar aap drafts approve karte raho.",
          "Campaigns that are running, paused or in draft. Progress shows how many leads are done. 'Awaiting approval' = how many drafts wait for your Approve (and how many need your text first); drafts of a campaign in draft or paused go out only after it is started / resumed. 'Est. finish' is an estimate based on the daily limit and the sending window, if you keep approving the drafts.",
        )}
        sub={progress.length
          ? t(`${progress.length} campaign · chal rahe, ruke hue aur draft`, `${progress.length} ${progress.length === 1 ? "campaign" : "campaigns"} · running, paused and draft`)
          : undefined}
        actions={<Link href="/campaigns" className="btn-ghost btn-sm"><span className="max-sm:hidden">{t("Saare campaigns", "All campaigns")}</span><span className="sm:hidden">{t("Sab dekho", "See all")}</span><Icon name="arrow-right" size={13} /></Link>}
      >
        {progress.length ? (
          <div className="overflow-x-auto">
            <table className="tbl tbl-stack">
              <thead><tr><th>{t("Naam", "Name")}</th><th>Status</th><th>Progress</th><th className="md:text-right">{t("Baaki", "Remaining")}</th><th className="md:text-right">{t("Approval baaki", "Awaiting approval")}</th><th>{t("Kab tak khatam", "Est. finish")}</th></tr></thead>
              <tbody>
                {progress.map(({ c, total, done, remaining, toApprove, toText, finish }) => (
                  <tr key={c.id}>
                    <td><Link href={`/campaigns/${c.id}`} className="link break-words">{c.name}</Link></td>
                    <td data-label="Status"><Badge v={c.status} /></td>
                    <td data-label="Progress" className="md:w-1/3">
                      <div className="w-36 md:w-full">
                        <Progress value={total ? done / total : 0} />
                        <div className="mt-1 text-xs tabular-nums text-slate-500">{t(`${done}/${total} ho gaye`, `${done}/${total} done`)}</div>
                      </div>
                    </td>
                    <td data-label={t("Baaki", "Remaining")} className="tabular-nums md:text-right">{remaining}</td>
                    <td data-label={t("Approval baaki", "Awaiting approval")} className="tabular-nums md:text-right">
                      {/* one block, so on phones it stays on the right of its label */}
                      <div>
                        {toApprove ? <Link href={`/review?c=${c.id}`} className="link">{toApprove}</Link> : <span className="text-slate-400">0</span>}
                        {toText > 0 && (
                          <Link href={`/review?s=text&c=${c.id}`} className="ml-1.5 whitespace-nowrap text-xs font-medium text-amber-700 hover:underline">
                            {t(`+${toText} text chahiye`, `+${toText} ${toText === 1 ? "needs" : "need"} your text`)}
                          </Link>
                        )}
                        {/* approving the drafts of a campaign in draft or paused sends nothing until it is started / resumed */}
                        {toApprove + toText > 0 && !isLive(c) && (
                          <span className="block text-2xs text-slate-400">
                            {c.status === "paused" ? t("Resume ke baad hi jayengi", "Sent only after resume") : t("Start ke baad hi jayengi", "Sent only after start")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td data-label={t("Kab tak khatam", "Est. finish")} className="whitespace-nowrap">{fmtDate(finish)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="megaphone" title={t("Koi active campaign nahi", "No active campaigns")}
            text={t(
              "Import ki hui list se campaign banao aur start karo. Worker har lead ka draft banayega; aap approve karoge tabhi mail jayegi.",
              "Create a campaign from an imported list and start it. The worker makes a draft for every lead; a mail goes out only once you approve it.",
            )}
            href="/campaigns" cta={t("Campaign banao", "Create campaign")} />
        )}
      </Section>

      {setupDone === 7 && (
        <details className="card-flush group">
          <summary className="flex cursor-pointer select-none items-center gap-3 px-4 py-3 transition hover:bg-slate-50/70 sm:px-5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><Icon name="check-circle" size={15} /></span>
            <span className="min-w-0 flex-1">
              <span className="h2 block">
                {t("Setup poora ho gaya (7/7)", "Setup complete (7/7)")}
                <Info className="ml-1.5" title="Setup guide" text={t(
                  "Pehli baar ke saare 7 setup kaam ho chuke hain. Kholke dekho kaunsa step kahan hota hai, jaise naya mailbox ya domain lagane pe.",
                  "All 7 first-time setup steps are done. Open this to see where each step happens, e.g. when you add a new mailbox or domain.",
                )} />
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">{t("Saare steps dobara dekhne ke liye kholo", "Open to see all steps again")}</span>
            </span>
            <Icon name="chevron-down" size={16} className="text-slate-400 transition group-open:rotate-180" />
          </summary>
          <div className="border-t border-slate-100"><SetupList steps={setup} current={-1} t={t} /></div>
        </details>
      )}

      {manual > 0 && (
        <ToastOnMount kind="warning" title={t(`${manual} mails ka manual check baaki hai`, `${manual} ${manual === 1 ? "mail needs" : "mails need"} a manual check`)}
          text={t("Pata nahi ye mails gayi ya nahi. Sent folder mein dekh ke har contact pe mark karo.", manual === 1 ? "Unclear if this mail went out. Check your Sent folder and mark the contact." : "Unclear if these mails went out. Check your Sent folder and mark each contact.")}
          href="/contacts?status=check_manual" cta={t("Check karo", "Check them")} once={`problem:dash-manual:${manual}`} />
      )}
      {bounceRate > 0.02 && (
        <ToastOnMount kind="warning" title={t(`Bounce rate ${bouncePct}% ho gaya`, `Bounce rate is now ${bouncePct}%`)}
          text={t("Last 50 mails mein 2% se zyada bounce. 5% pe sending apne aap ruk jayegi, list check karo.", "Over 2% of the last 50 mails bounced. At 5% sending stops automatically, so check your list.")}
          href="/contacts?status=bounced" cta={t("Bounce dekho", "See bounces")} once={`problem:dash-bounce:${bouncePct}`} />
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
function SetupList({ steps, current, t, guided = -1, show = "all" }: { steps: SetupStep[]; current: number; t: T; guided?: number; show?: "all" | "todo" | "done" }) {
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
              {x.done ? t("Dekho", "View") : x.cta}<Icon name="chevron-right" size={13} className={x.done ? "text-slate-400" : ""} />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
