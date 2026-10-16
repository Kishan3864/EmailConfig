import Link from "next/link";
import { pipeline, queueEstimate, queuedCount } from "@/lib/campaign";
import { C, count, rows, type Campaign, type Message, type Lead, type LeadList } from "@/lib/fsdb";
import { getSettings } from "@/lib/settings";
import { fullText } from "@/lib/compose";
import { englishOf, textKey } from "@/lib/english";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { getAllChunked } from "@/lib/ledger";
import { knowsWhatTheyDo } from "@/lib/leadinfo";
import { LOGO_HEIGHT, LOGO_PNG_BASE64, LOGO_WIDTH } from "@/lib/logo";
import { capsAllowed, isTemplateId, mailPlan, missingMark, TEMPLATE_IDS, templateForLead, templateLabel, templateOf, templateVars } from "@/lib/templates";
import { fmtDate } from "@/lib/time";
import { siteStatus } from "@/lib/website";
import { ActionButton } from "@/components/ActionButton";
import { EnglishMail } from "@/components/EnglishMail";
import { knownItems, parseFacts, siteNote } from "@/components/factChips";
import { Info } from "@/components/Info";
import { Icon } from "@/components/icons";
import { forText, siteGroup, siteText } from "@/components/siteText";
import { ToastOnMount } from "@/components/toast";
import { Badge, Callout, EmptyState, MailPreview, NextStep, PageHeader, Section } from "@/components/ui";
import { approveMessage, approveAllShown, rejectMessage, regenerateDraft, translateMessage } from "../actions";
import { ruleText } from "../settings/template-check";
import { DraftEditor } from "./DraftEditor";
import { SelectionBar } from "./SelectionBar";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Approve karo", "Approve mails") };
}

/**
 * The worker sends only approved mails of a started, running campaign (lib/sender.ts). Approving a mail of any other
 * campaign keeps it in the queue, but nothing goes out until the campaign runs: the card says why.
 */
function campaignHold(c: Campaign | null, t: T): { title: string; text: string } | null {
  if (!c) return { title: t("Is mail ka campaign nahi mila", "This mail's campaign was not found"), text: t("Approve karne pe bhi ye mail nahi jayegi.", "Even if you approve it, this mail will not be sent.") };
  if (!c.samplesApproved) {
    return {
      title: t("Campaign abhi start nahi hua", "The campaign has not started yet"),
      text: t(
        "Approve kar sakte ho, par mail tabhi jayegi jab Campaign page pe ‘Campaign start karo’ dabaoge. Start karne se koi mail approve nahi hoti: approve sirf aap yahan karte ho.",
        "You can approve it, but the mail goes out only after you press ‘Start campaign’ on the Campaign page. Starting approves nothing: only you approve, here.",
      ),
    };
  }
  if (c.status === "paused") return { title: t("Campaign ruka hua hai", "The campaign is paused"), text: t("Approve ki hui mail queue mein rahegi aur tabhi jayegi jab Campaign page pe ‘Resume karo’ dabaoge.", "An approved mail stays in the queue and goes out only after you press ‘Resume’ on the Campaign page.") };
  if (c.status === "done") return { title: t("Campaign poora ho chuka hai", "The campaign has already finished"), text: t("Approve karne pe bhi ye mail nahi jayegi.", "Even if you approve it, this mail will not be sent.") };
  if (c.status !== "running") return { title: t("Campaign chal nahi raha", "The campaign is not running"), text: t("Approve karne pe bhi ye mail nahi jayegi.", "Even if you approve it, this mail will not be sent.") };
  return null;
}

/**
 * The unsent drafts of one tab. Approval baaki = ready and not approved; Text chahiye = needs_text (never approved).
 * Indexes: with a campaign (campaignId,status,approved,createdAt) / (campaignId,status,createdAt), without one
 * (approved,status,createdAt)
 */
function tabQuery(state: "wait" | "text", campaignId?: string) {
  if (state === "text") {
    return campaignId
      ? C.messages.where("campaignId", "==", campaignId).where("status", "==", "needs_text")
      : C.messages.where("approved", "==", false).where("status", "==", "needs_text");
  }
  return campaignId
    ? C.messages.where("campaignId", "==", campaignId).where("status", "==", "ready").where("approved", "==", false)
    : C.messages.where("approved", "==", false).where("status", "==", "ready");
}

/** Phones: long labels (e.g. the armed Reject text) wrap inside the button instead of overflowing the 2-column grid. */
const WRAP = "max-sm:h-auto max-sm:min-h-9 max-sm:whitespace-normal max-sm:py-1.5 max-sm:text-center max-sm:leading-tight";
const CHIP = "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium ring-1 ring-inset transition";
const LIMIT = 50; // cards shown
const byDate = (a: Message, b: Message) => (a.createdAt || "").localeCompare(b.createdAt || "");

type Search = { c?: string; tpl?: string; s?: string };

export default async function Review({ searchParams }: { searchParams: Promise<Search> }) {
  const { t, lang } = await getT();
  const sp = await searchParams;
  const s = await getSettings();
  // ?s=wait (default) "Approval baaki" | ?s=text "Text chahiye"; ?tpl=tpl1..tpl6 | own | ai; ?c=<campaign id>
  const state: "wait" | "text" = sp.s === "text" ? "text" : "wait";
  const tplF = isTemplateId(sp.tpl) || sp.tpl === "own" || sp.tpl === "ai" ? sp.tpl : "";
  // an unknown campaign id is ignored (Firestore ids never hold "/")
  const cSnap = sp.c && /^[\w-]{1,200}$/.test(sp.c) ? await C.campaigns.doc(sp.c).get() : null;
  const camp = cSnap?.exists ? ({ id: cSnap.id, ...cSnap.data() } as Campaign) : null;

  const waitQ = tabQuery("wait", camp?.id);
  const textQ = tabQuery("text", camp?.id);
  const tabQ = state === "text" ? textQ : waitQ;
  // the template filter: equality filters only, so Firestore merges its single-field indexes (no composite index).
  // Without an orderBy the matches come in id order: at most LIMIT are read, then sorted by date here.
  // ?tpl=ai: drafts from before "custom" was stored have no such field and are not found (they still show unfiltered)
  const tplQ = !tplF ? null
    : tplF === "own" ? tabQ.where("custom", "==", true)
      : tplF === "ai" ? tabQ.where("tplId", "==", null).where("custom", "==", false)
        : tabQ.where("tplId", "==", tplF);
  // a filtered campaign's pipeline already holds both tab counts (in DRY-RUN its queue leaves out what went to the test address)
  const pipe = camp ? await pipeline(camp.id, s.dryRun) : null;
  const [fetched, matchN, waitN, textN, active, eta] = await Promise.all([
    (tplQ ?? tabQ.orderBy("createdAt")).limit(LIMIT).get().then((q) => rows<Message>(q)),
    tplQ ? count(tplQ) : 0,
    pipe ? pipe.waiting : count(waitQ),
    pipe ? pipe.needsText : count(textQ),
    C.campaigns.where("status", "in", ["draft", "running", "paused"]).get().then((q) => rows<Campaign>(q)),
    camp && pipe ? queueEstimate(s, camp, pipe.queued) : null,
  ]);

  // Drafts made before tplId was stored have no tplId field, so the equality filter never finds them. They come from a
  // one-template campaign (mailType = that template), and they are its oldest drafts: its own tab query in date order
  // finds them first. LIMIT reads in all, shared between such campaigns.
  const oneTpl = isTemplateId(tplF) ? (camp ? [camp] : active).filter((c) => c.mailType === tplF) : [];
  const per = oneTpl.length ? Math.ceil(LIMIT / oneTpl.length) : 0;
  const olds = await Promise.all(oneTpl.map((c) => tabQuery(state, c.id).orderBy("createdAt").limit(per).get().then((q) => rows<Message>(q))));
  const legacy = olds.flat().filter((m) => m.tplId === undefined && !m.custom);
  // a full read whose newest draft is still an old one: there may be more old ones after it
  const moreOld = olds.some((q) => q.length === per && q[q.length - 1].tplId === undefined);
  const pending = [...new Map([...fetched, ...legacy].map((m) => [m.id, m])).values()].sort(byDate).slice(0, LIMIT);
  const n = pending.length;
  const total = state === "text" ? textN : waitN;
  // more than shown: the tab count says so, or (template filter) the count of the same filters / old drafts not read
  const more = tplF ? matchN + legacy.length > n || moreOld : total > n;

  // the campaigns: the active ones, the filtered one and those of the drafts shown (read once each)
  const campaigns = new Map<string, Campaign | null>(active.map((c) => [c.id, c]));
  if (camp) campaigns.set(camp.id, camp);
  const unknown = [...new Set(pending.map((m) => m.campaignId).filter((id) => id && !campaigns.has(id)))];
  for (const d of await getAllChunked(unknown.map((id) => C.campaigns.doc(id)))) campaigns.set(d.id, d.exists ? ({ id: d.id, ...d.data() } as Campaign) : null);

  // the leads and lists of the cards shown, in batches
  const leads = new Map<string, Lead>();
  for (const d of await getAllChunked(pending.map((m) => C.leads.doc(m.leadId)))) if (d.exists) leads.set(d.id, { id: d.id, ...d.data() } as Lead);
  const lists = new Map<string, LeadList>();
  const listIds = [...new Set([...leads.values()].map((l) => l.listId).filter(Boolean))];
  for (const d of await getAllChunked(listIds.map((id) => C.lists.doc(id)))) if (d.exists) lists.set(d.id, d.data() as LeadList);

  // without a campaign filter: one line per active campaign (counts only)
  const overview = camp ? [] : await Promise.all([...active].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(async (c) => {
    const msgs = C.messages.where("campaignId", "==", c.id);
    const [waiting, needsText, queued] = await Promise.all([
      count(msgs.where("status", "==", "ready").where("approved", "==", false)),
      count(msgs.where("status", "==", "needs_text")),
      queuedCount(c.id, s.dryRun),
    ]);
    return { c, waiting, needsText, queued };
  }));
  const campOptions = [...campaigns.values()].filter((c): c is Campaign => !!c).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const qs = (o: Search) => {
    const v = { c: camp?.id || "", tpl: tplF, s: state as string, ...o };
    const p = new URLSearchParams();
    if (v.c) p.set("c", v.c);
    if (v.tpl) p.set("tpl", v.tpl);
    if (v.s === "text") p.set("s", "text");
    const q = p.toString();
    return q ? `/review?${q}` : "/review";
  };
  const filtered = !!camp || !!tplF;

  // a filtered campaign that cannot send shows its reason once on top; otherwise every card shows its own
  const campHold = camp ? campaignHold(camp, t) : null;
  const holdOf = (m: Message) => (m.campaignId ? campaignHold(campaigns.get(m.campaignId) ?? null, t) : null);
  const held = pending.filter((m) => holdOf(m));
  // the campaigns behind the held mails that can be opened (one → link straight to it)
  const heldCampaigns = [...new Set(held.map((m) => m.campaignId))].filter((id) => campaigns.get(id));
  const ready = pending.filter((m) => m.status === "ready");
  const sentHref = s.dryRun ? "/sent?mode=dry" : "/sent";
  const sendLine = s.dryRun
    ? t(
      "Approve ki hui mails send queue mein jaati hain: worker unhe sending window mein ek-ek karke (random gap aur daily limit ke andar) aapke test address pe bhejta hai. Wo Sent page ke Dry-run tab mein dikhengi.",
      "Approved mails go into the send queue: the worker sends them one by one in the sending window (with a random gap, within the daily limit) to your test address. They show up in the Dry-run tab of the Sent page.",
    )
    : t(
      "Approve ki hui mails send queue mein jaati hain: worker unhe apne aap bhejta hai, sending window aur din (campaign ke timezone mein), random gap, warm-up daily limit aur 40% plan limit ke andar. Kya gaya, wo Sent page pe dikhega.",
      "Approved mails go into the send queue: the worker sends them by itself, within the sending window and days (in the campaign's timezone), a random gap, the warm-up daily limit and the 40% plan cap. What was sent shows up on the Sent page.",
    );
  const info = t(
    `Ye aakhri step hai. Campaign start hone ke baad worker har Ready lead ka draft banata hai (template se, lead ke apne text se ya AI se), aur har draft yahan ‘Approval baaki’ mein rukta hai. Aapke Approve click ke siwa koi bhi cheez mail approve nahi karti: na campaign start, na samples, na LIVE switch.
Approve karo = mail send queue mein jaati hai aur worker use apne aap bhejta hai: sending window aur din (campaign ke timezone mein), random gap, warm-up daily limit aur 40% plan limit ke andar. Ledger, Block List aur auto-pause har baar check hote hain.
Ek mail approve karo, checkbox se chuni hui mails ‘Selected approve karo’ se, ya upar ‘Sab approve karo’ se (dono mein dusra click confirm karta hai).
‘Text chahiye’ = mail aapke text ka wait kar rahi hai: template ko {{observation}} chahiye tha par lead ke paas nahi tha ([OBSERVATION]), bhara hua template ya lead ka apna text kisi rule pe fail hua, ya AI 5 baar mein bhi mail nahi likh paya. Har card pe wajah likhi hai. ‘Text edit karo’ se theek karo aur save karo (save pe text dobara check hota hai), phir mail ‘Approval baaki’ mein aa jayegi.
Left = mail bilkul jaisi lead ko jayegi (uski bhasha mein). Right = usi mail ka English matlab, sirf aapke check ke liye. Naya version = same template se (ya AI se) dobara banegi. Reject = is lead ko kabhi mail nahi jayegi.
DRY-RUN mein approve ki hui mail test address pe jaati hai. Approval yaad rehta hai: LIVE on karne ke baad wahi mail asli lead ko bhi jayegi.`,
    `This is the last step. Once a campaign is started, the worker makes a draft for every Ready lead (from a template, the lead's own text or the AI), and every draft waits here under ‘Awaiting approval’. Nothing but your own Approve click approves a mail: not the campaign start, not the samples, not the LIVE switch.
Approve = the mail goes into the send queue and the worker sends it by itself: within the sending window and days (in the campaign's timezone), a random gap, the warm-up daily limit and the 40% plan cap. The Ledger, the Block List and auto-pause are checked every time.
Approve one mail, the ticked ones with ‘Approve selected’, or everything shown with ‘Approve all’ at the top (both ask for a second click).
‘Needs your text’ = the mail waits for your text: its template needs {{observation}} but the lead has none ([OBSERVATION]), the filled template or the lead's own text broke a rule, or the AI could not write it in 5 tries. Every card says why. Fix it with ‘Edit text’ and save (the text is checked again on save); the mail then moves to ‘Awaiting approval’.
Left = the mail exactly as the lead gets it (in its language). Right = the same mail's meaning in English, only for you to check. New version = made again from the same template (or by the AI). Reject = this lead will never be emailed.
In DRY-RUN an approved mail goes to your test address. The approval is kept: once LIVE is on, the same mail also goes to the real lead.`,
  );

  const tab = (v: "wait" | "text", label: string, k: number) => (
    <Link href={qs({ s: v })} aria-current={state === v ? "page" : undefined} className={`seg-item ${state === v ? "seg-item-on" : ""}`}>
      {label}
      <span className={`min-w-[18px] rounded-full px-1 text-center text-2xs font-semibold tabular-nums ${state === v ? (v === "text" && k ? "bg-amber-50 text-amber-700" : "bg-indigo-50 text-indigo-700") : "bg-slate-300/50 text-slate-500"}`}>{k}</span>
    </Link>
  );
  const started = !!camp?.samplesApproved && camp.status === "running";
  const chips = pipe ? [
    { key: "toCreate", label: t("Drafts banne baaki", "Drafts still to make"), n: pipe.toCreate, dot: "bg-slate-400" },
    { key: "needsText", label: t("Text chahiye", "Needs your text"), n: pipe.needsText, dot: "bg-amber-500", href: qs({ s: "text" }), on: state === "text" },
    { key: "waiting", label: t("Approval baaki", "Awaiting approval"), n: pipe.waiting, dot: "bg-sky-500", href: qs({ s: "wait" }), on: state === "wait" },
    { key: "queued", label: t("Approved (queue mein)", "Approved (in the queue)"), n: pipe.queued, dot: "bg-indigo-500" },
    // DRY-RUN: approved mails that already went to the test address; they go to the leads once LIVE is on
    ...(s.dryRun ? [{ key: "dryDone", label: t("Dry-run mein gayi", "Sent in dry-run"), n: pipe.dryDone, dot: "bg-violet-500" }] : []),
    { key: "sent", label: t("Bheji gayi", "Sent"), n: pipe.sent, dot: "bg-emerald-500" },
    { key: "failed", label: t("Fail", "Failed"), n: pipe.failed, dot: "bg-red-500" },
    { key: "skipped", label: t("Skip", "Skipped"), n: pipe.skipped, dot: "bg-slate-300" },
  ] : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Mails approve karo", "Approve mails")}
        info={info}
        sub={<>
          {waitN
            ? t(`${waitN} ${waitN === 1 ? "mail aapke approval ka wait kar rahi hai" : "mails aapke approval ka wait kar rahi hain"}`, `${waitN} ${waitN === 1 ? "mail is waiting for your approval" : "mails are waiting for your approval"}`)
            : t("Abhi koi mail aapke approval ka wait nahi kar rahi", "No mails are waiting for your approval right now")}
          {textN > 0 && <span className="text-amber-700"> · {t(`${textN} ‘Text chahiye’ mein`, `${textN} in ‘Needs your text’`)}</span>}
          {camp && <> · {camp.name}</>}
        </>}
        actions={state === "wait" && ready.length > 1 && (
          <ActionButton action={approveAllShown.bind(null, ready.map((m) => `${m.id}::${textKey(m.subject, m.body)}`))} label={t(`Sab ${ready.length} approve karo`, `Approve all ${ready.length}`)} icon="check-check" className="btn w-full sm:w-auto"
            confirmText={t(`Dobara dabao: dikh rahi sab ${ready.length} mails approve hongi`, `Click again: approve all ${ready.length} mails shown`)} next={sentHref} nextCta={t("Sent page dekho", "See sent mails")} />
        )}
      />

      {s.dryRun ? (
        <Callout tone={s.testEmail ? "warn" : "danger"} title="DRY-RUN mode" action={s.testEmail
          ? <Link href="/#mode" className="btn btn-sm">{t("Mode dekho", "See mode")}</Link>
          : <Link href="/settings" className="btn btn-sm">{t("Settings kholo", "Open settings")}</Link>}>
          {s.testEmail
            ? t(
              `Abhi approve ki hui mails sirf aapke test address (${s.testEmail}) pe jayengi. Dhyan do: approval yaad rehta hai, LIVE on karne ke baad yahi mails bina dobara pooche asli leads ko jayengi. Sirf wahi approve karo jo sach mein lead ko bhejni hai.`,
              `For now, approved mails go only to your test address (${s.testEmail}). Note: the approval is kept; once LIVE is on, these same mails go to the real leads without asking again. Only approve what you really want to send to the lead.`,
            )
            : t(
              "Approve ki hui mails sirf test address pe jayengi, lekin Settings mein Test address abhi set nahi hai. Dhyan do: approval yaad rehta hai, LIVE on karne ke baad yahi mails bina dobara pooche asli leads ko jayengi.",
              "Approved mails go only to the test address, but no Test address is set in Settings yet. Note: the approval is kept; once LIVE is on, these same mails go to the real leads without asking again.",
            )}
        </Callout>
      ) : (
        <Callout tone="info" title="LIVE mode">{t(
          "Approve ki hui mails queue mein jaati hain aur apne aap asli leads ko bheji jaati hain. Approve hi aakhri step hai: approve karne se pehle har mail dhyan se padho.",
          "Approved mails go into the queue and are sent to the real leads automatically. Approve is the last step: read every mail carefully before you approve it.",
        )}</Callout>
      )}
      {s.dryRun && !s.testEmail && (
        <ToastOnMount kind="warning" title={t("Test address set nahi hai", "No test address set")}
          text={t("DRY-RUN mein approve ki hui mails test address pe jaati hain. Settings mein Test address daalo.", "In DRY-RUN, approved mails go to the test address. Add a Test address in Settings.")}
          href="/settings" cta={t("Settings kholo", "Open settings")} once="review:no-test-address" />
      )}

      {/* filters: a plain GET form and links, so the page keeps no state of its own */}
      <form key={`${camp?.id || ""}|${tplF}|${state}`} action="/review" className="card space-y-3" role="search">
        {state === "text" && <input type="hidden" name="s" value="text" />}
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <select name="c" defaultValue={camp?.id || ""} aria-label="Campaign" className="input min-w-0">
            <option value="">{t("Sab campaigns", "All campaigns")}</option>
            {campOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="tpl" defaultValue={tplF} aria-label="Template" className="input min-w-0">
            <option value="">{t("Sab templates aur AI", "All templates and AI")}</option>
            {TEMPLATE_IDS.map((id) => <option key={id} value={id}>{templateLabel(s, id)}</option>)}
            <option value="own">{t("Lead ka apna text (CSV)", "The lead's own text (CSV)")}</option>
            <option value="ai">{t("AI ki likhi", "Written by the AI")}</option>
          </select>
          <div className="flex gap-2">
            <button className="btn-primary flex-1 sm:flex-none"><Icon name="filter" size={14} />{t("Filter karo", "Filter")}</button>
            {filtered && (
              <Link href={qs({ c: "", tpl: "" })} className="btn-ghost shrink-0 max-sm:w-9 max-sm:px-0" title={t("Saare filter hatao", "Clear all filters")} aria-label={t("Saaf karo", "Clear")}>
                <Icon name="x" size={14} /><span className="hidden sm:inline">{t("Saaf karo", "Clear")}</span>
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
          <nav className="seg" aria-label={t("Approve ke tab", "Approve tabs")}>
            {tab("wait", t("Approval baaki", "Awaiting approval"), waitN)}
            {tab("text", t("Text chahiye", "Needs your text"), textN)}
          </nav>
          <Info title={t("Filter aur tab", "Filters and tabs")}
            text={t(
              "‘Approval baaki’ = poori bani mails jo sirf aapke Approve ka wait kar rahi hain. ‘Text chahiye’ = mails jinmein aapka text chahiye ({{observation}} nahi tha, koi rule toota, ya AI mail nahi likh paya): inhe pehle Text edit se theek karo, inka Approve button nahi hota. Campaign aur template chun ke sirf wahi mails dekho. Tab ki ginti template filter ke bina hai.",
              "‘Awaiting approval’ = complete mails that only wait for your Approve. ‘Needs your text’ = mails that need your text ({{observation}} was missing, a rule was broken, or the AI could not write the mail): fix them with Edit text first; they have no Approve button. Pick a campaign and a template to see only those mails. The tab counts ignore the template filter.",
            )} />
        </div>
      </form>

      {camp && pipe && (
        <Section icon="megaphone" title={camp.name}
          sub={started ? t("Campaign chal raha hai", "The campaign is running") : camp.samplesApproved ? t("Campaign abhi chal nahi raha", "The campaign is not running right now") : t("Campaign abhi start nahi hua: drafts start ke baad banengi", "The campaign has not started: drafts are made after the start")}
          info={t(
            `Is campaign ki har lead kahan hai. Drafts banne baaki = Ready leads jinka draft worker abhi banayega (start ke baad, har minute thode-thode). Text chahiye = draft mein aapka text chahiye ([OBSERVATION], koi toota rule, ya AI nahi likh paya). Approval baaki = aapke Approve ka wait. Approved (queue mein) = aapne approve ki, worker limits ke andar bhejega.${s.dryRun ? " Dry-run mein gayi = approved mails jo test address pe ja chuki hain; LIVE on karne ke baad wahi mails asli lead ko jayengi." : ""} Fail = fail ya manual check. Skip = pehle contact hua, Block List ya reject.`,
            `Where every lead of this campaign stands. Drafts still to make = Ready leads whose draft the worker makes next (after the start, a few every minute). Needs your text = the draft needs your text ([OBSERVATION], a broken rule, or the AI could not write it). Awaiting approval = waits for your Approve. Approved (in the queue) = you approved it; the worker sends it within the limits.${s.dryRun ? " Sent in dry-run = approved mails that already went to your test address; once LIVE is on, the same mails go to the real leads." : ""} Failed = failed or manual check. Skipped = already contacted, Block List or rejected.`,
          )}
          actions={<Link href={`/campaigns/${camp.id}`} className="btn btn-sm">{t("Campaign kholo", "Open campaign")}<Icon name="arrow-right" size={13} /></Link>}>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((ch) => {
              const inner = <><span className={`h-1.5 w-1.5 rounded-full ${ch.dot}`} />{ch.label}<span className="font-semibold tabular-nums text-slate-900">{ch.n}</span></>;
              return ch.href
                ? <Link key={ch.key} href={ch.href} aria-current={ch.on ? "true" : undefined} className={`${CHIP} ${ch.on ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900"}`}>{inner}</Link>
                : <span key={ch.key} className={`${CHIP} bg-white text-slate-600 ring-slate-200`}>{inner}</span>;
            })}
          </div>
          <div className="mt-3 flex items-start gap-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
            <Icon name="calendar" size={13} className="mt-px shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1 break-words">
              {!pipe.queued
                ? t("Queue khaali hai: abhi koi approved mail bhejne ke liye nahi ruki.", "The queue is empty: no approved mail is waiting to be sent.")
                : eta
                  ? <>
                    {t("Approved queue ka andaza:", "Approved queue estimate:")} <span className="font-medium text-slate-900">{fmtDate(eta)}</span>
                    {!started && ` ${t("(campaign chalne ke baad)", "(once the campaign runs)")}`}
                  </>
                  : t("Approved queue ka andaza abhi nahi ban paya: Settings mein sending din aur limits check karo.", "No estimate for the approved queue yet: check the sending days and limits in Settings.")}
            </span>
            <Info title={t("Queue ka andaza", "Queue estimate")} size={13}
              text={t(
                "Sirf approved mails gini jaati hain, aaj ki limits se: sending window aur din (campaign ke timezone mein), gap, warm-up daily limit aur 40% plan limit. Purane chal rahe campaigns ki approved mails pehle jaati hain, isliye wo bhi aage gini gayi hain. Bounce, reply ya auto-pause se asli date badal sakti hai.",
                "Only approved mails count, with today's limits: the sending window and days (in the campaign's timezone), the gap, the warm-up daily limit and the 40% plan cap. Approved mails of older running campaigns go first, so they are counted ahead. Bounces, replies or an auto-pause can change the real date.",
              )} />
          </div>
        </Section>
      )}

      {!camp && overview.length > 0 && (
        <Section flush icon="megaphone" title={t("Campaigns ka haal", "Campaigns at a glance")}
          info={t(
            "Har chalu campaign (draft, chal raha, ruka hua) ki ek line: kitni mails aapke Approve ka wait kar rahi hain, kitni ‘Text chahiye’ mein hain aur kitni approved mails queue mein bhejne ke liye hain. Campaign pe click karo to sirf uski mails aur uski poori pipeline dikhegi.",
            "One line per active campaign (draft, running, paused): how many mails wait for your Approve, how many are in ‘Needs your text’, and how many approved mails are queued to be sent. Click a campaign to see only its mails and its full pipeline.",
          )}>
          <ul className="divide-y divide-slate-100">
            {overview.map(({ c, waiting, needsText, queued }) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:px-5">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Link href={qs({ c: c.id })} className="min-w-0 truncate text-sm font-medium text-slate-900 hover:text-indigo-600">{c.name}</Link>
                  <Badge v={c.samplesApproved ? c.status : "draft"} label={c.samplesApproved ? undefined : t("Start nahi hua", "Not started")} />
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span><span className="font-semibold tabular-nums text-slate-900">{waiting}</span> {t("approval baaki", "awaiting approval")}</span>
                  {needsText > 0 && <span className="text-amber-700"><span className="font-semibold tabular-nums">{needsText}</span> {t("‘Text chahiye’ mein", "in ‘Needs your text’")}</span>}
                  <span><span className="font-semibold tabular-nums text-slate-900">{queued}</span> {t("queue mein", "in the queue")}</span>
                  <Link href={qs({ c: c.id })} className="link inline-flex items-center gap-0.5">{t("Sirf ye dekho", "Show only this")}<Icon name="chevron-right" size={12} /></Link>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {campHold && (
        <Callout tone="warn" title={campHold.title} action={<Link href={`/campaigns/${camp!.id}`} className="btn btn-sm">{t("Campaign kholo", "Open campaign")}</Link>}>
          {campHold.text}
        </Callout>
      )}
      {more && n > 0 && (
        <p className="text-xs text-slate-500">
          {t(`Pehli ${n} mails dikh rahi hain. Inhe approve / poora karne ke baad baaki apne aap yahan aa jayengi.`, `Showing the first ${n} mails. Once you approve / complete them, the rest show up here.`)}
        </p>
      )}

      <div className="space-y-4">
        {pending.map((m, i) => {
          const lead = leads.get(m.leadId);
          const list = lead ? lists.get(lead.listId) : undefined;
          const camp1 = m.campaignId ? campaigns.get(m.campaignId) : undefined;
          const hold = campHold ? null : holdOf(m);
          const needsText = m.status === "needs_text";
          // why a "Text chahiye" draft waits: details the lead lacks ([OBSERVATION]; older drafts do not list them, so
          // look for the mark), rules the text broke, or the AI failed 5 times (no text at all, the last error in problems)
          const missing = !needsText ? [] : m.missing?.length ? m.missing : `${m.subject}\n${m.body}`.includes(missingMark("observation")) ? ["observation"] : [];
          const marks = missing.map(missingMark);
          const problems = needsText ? (m.problems || []).filter(Boolean) : [];
          const aiFailed = needsText && !m.body.trim();
          // a template campaign fills a fixed text (no AI, so no AI facts); an AI campaign gets only the known facts.
          // The draft names its template; older drafts do not, so pick it again from the campaign.
          const tplId = m.custom ? null : isTemplateId(m.tplId) ? m.tplId : (camp1 ? templateForLead(camp1, lead?.website, m.tplId)?.id : undefined) ?? null;
          const tpl = tplId ? templateOf(s, tplId) : null;
          const bySite = !!camp1 && mailPlan(camp1).kind === "bysite";
          const own = siteStatus(lead?.website);
          // a template tagged for one group, used for a lead of the other (one template for all, or the tag changed later)
          const offTag = !!lead && !!tpl && tpl.for !== "any" && (tpl.for === "site") !== own.has;
          const facts = parseFacts(lead?.facts);
          const known = lead ? knownItems(lead, facts, lang) : [];
          const site = lead ? siteNote(lead.website, facts, lang) : null;
          const guessed = !!lead && !knowsWhatTheyDo(known);
          const name = m.businessName || m.leadEmail;
          // the lead's own values (business, city…) may be in capitals: not my ALL CAPS (same as the server check)
          const allowCaps = lead ? capsAllowed(templateVars(lead, s)) : [];
          // the right-hand side: this mail's own English version, made from its current text
          const en = englishOf(m);
          const selectable = state === "wait" && !needsText && ready.length > 1;
          return (
            // keyed by the text too: a new version is a new card (a ticked box never carries over to text I have not read)
            <article key={`${m.id}:${textKey(m.subject, m.body)}`} className="card-flush">
              <header className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
                {selectable && (
                  <label className="-my-1 -ml-1 grid h-11 w-7 shrink-0 cursor-pointer place-items-center" title={t("Is mail ko chuno", "Select this mail")}>
                    <input type="checkbox" name="ids" value={`${m.id}::${textKey(m.subject, m.body)}`} form="approve-sel" aria-label={t(`${name} ki mail chuno`, `Select the mail to ${name}`)} />
                  </label>
                )}
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-600">{(Array.from(name.trim())[0] || "?").toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link href={`/contacts/${encodeURIComponent(m.leadId)}`} className="min-w-0 truncate text-sm font-semibold text-slate-900 hover:text-indigo-600">{name}</Link>
                    <Badge v="language" label={m.language.toUpperCase()} tone="indigo" dot={false} />
                    {needsText && <Badge v="needs_text" label={t("Text chahiye", "Needs your text")} tone="amber" />}
                    {m.edited && <Badge v="edited" label={t("Aapne edit kiya", "Edited by you")} tone="amber" />}
                  </div>
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1"><Icon name="mail" size={12} className="text-slate-400" /><span className="truncate">{m.leadEmail}</span></span>
                    {lead?.website && <span className="inline-flex min-w-0 max-w-full items-center gap-1"><Icon name="globe" size={12} className="text-slate-400" /><span className="truncate">{lead.website}</span></span>}
                    {camp1 && (
                      <Link href={`/campaigns/${camp1.id}`} className="inline-flex min-w-0 max-w-full items-center gap-1 hover:text-indigo-600">
                        <Icon name="megaphone" size={12} className="text-slate-400" /><span className="truncate">{camp1.name}</span>
                      </Link>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                  <span className="text-2xs font-medium tabular-nums text-slate-400" title={t(`${n} mein se mail number ${i + 1}`, `Mail ${i + 1} of ${n}`)}>{i + 1}/{n}</span>
                  <Info title={t("Ye card kya hai", "About this card")} size={13}
                    text={needsText
                      ? t(
                        "Ye draft aapke text ka wait kar rahi hai; kyun, wo card ke peele box mein likha hai ([OBSERVATION] ki jagah apna sentence, koi toota rule, ya AI mail nahi likh paya). ‘Text edit karo’ kholo, theek karo aur save karo: save pe text dobara check hota hai, phir ye ‘Approval baaki’ mein aa jayegi aur approve ho sakegi. Naam pe click karo to contact ki poori history khulegi, campaign ke naam pe click karo to campaign ka page.",
                        "This draft waits for your text; the yellow box on the card says why (your own sentence in place of [OBSERVATION], a broken rule, or the AI could not write the mail). Open ‘Edit text’, fix it and save: the text is checked again on save, then it moves to ‘Awaiting approval’ and can be approved. Click the name to open the contact's full history, or the campaign name to open the campaign page.",
                      )
                      : t(
                        "Is lead ki draft; kahan se bani (template, lead ka apna text ya AI), wo upar wali line mein likha hai. Naam pe click karo to contact ki poori history khulegi, campaign ke naam pe click karo to campaign ka page. Left wali mail padho aur right mein uska English matlab check karo, phir neeche se Approve, Edit, Naya version ya Reject karo. Checkbox se kai mails chun ke ek saath approve kar sakte ho.",
                        "This lead's draft; the line at the top says where it came from (a template, the lead's own text or the AI). Click the name to open the contact's full history, or the campaign name to open the campaign page. Read the mail on the left and check its English meaning on the right, then choose Approve, Edit, New version or Reject below. Tick the checkboxes to approve several mails at once.",
                      )} />
                </div>
              </header>

              <div className="space-y-4 p-4 sm:p-5">
                {needsText && (
                  <Callout tone="warn" title={t("Text chahiye", "Needs your text")}>
                    <div className="space-y-1.5">
                      {aiFailed ? (
                        <p>{t(
                          "AI ye mail nahi likh paya (5 baar koshish ki). ‘Text edit karo’ kholo aur subject aur poora text khud likho, mail ki bhasha mein.",
                          "The AI could not write this mail (it tried 5 times). Open ‘Edit text’ and write the subject and the whole text yourself, in the mail's language.",
                        )}</p>
                      ) : missing.includes("observation") ? (
                        <p>{t(
                          `Is mail ke ${m.custom ? "apne text (CSV)" : "template"} ko {{observation}} chahiye (unki website pe aapki khud dekhi hui ek asli problem), par is lead ke import mein wo nahi thi, isliye koi fallback nahi bhara gaya. ‘Text edit karo’ kholo, ${marks.join(", ")} ki jagah apna ek sach sentence likho.`,
                          `This mail's ${m.custom ? "own text (CSV)" : "template"} needs {{observation}} (one real problem you saw on their website yourself), but this lead's import had none, so no fallback was filled in. Open ‘Edit text’ and replace ${marks.join(", ")} with one true sentence of your own.`,
                        )}</p>
                      ) : marks.length ? (
                        <p>{t(`‘Text edit karo’ kholo aur ${marks.join(", ")} ki jagah apna sach text likho.`, `Open ‘Edit text’ and replace ${marks.join(", ")} with true text of your own.`)}</p>
                      ) : !problems.length && (
                        <p>{t("‘Text edit karo’ kholo, mail padh ke theek karo.", "Open ‘Edit text’, read the mail and fix it.")}</p>
                      )}
                      {problems.length > 0 && (
                        <div>
                          <p>{aiFailed
                            ? t("Aakhri koshish kyun fail hui:", "Why the last try failed:")
                            : m.custom
                              ? t("Lead ka apna text (CSV) in rules pe fail hua:", "The lead's own text (CSV) broke these rules:")
                              : t("Bhara hua template in rules pe fail hua:", "The filled template broke these rules:")}</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4">
                            {problems.map((e, k) => <li key={k} className="break-words">{ruleText(e, t)}</li>)}
                          </ul>
                          {!aiFailed && <p className="mt-1">{t("Inhe ‘Text edit karo’ se theek karo: save pe edit dobara check hota hai.", "Fix them with ‘Edit text’: the edit is checked again when you save.")}</p>}
                        </div>
                      )}
                      <p>{t("Save hote hi (rules check pass karke) mail ‘Approval baaki’ mein aa jayegi; wahan padh ke approve karo.", "Once the edit is saved (it must pass the rules check), the mail moves to ‘Awaiting approval’; read it there and approve it.")}</p>
                    </div>
                  </Callout>
                )}
                {hold && (
                  <Callout tone="warn" title={hold.title}
                    action={camp1 && <Link href={`/campaigns/${camp1.id}`} className="btn btn-sm">{t("Campaign kholo", "Open campaign")}</Link>}>
                    {hold.text}
                  </Callout>
                )}
                {m.custom ? (
                  <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                    <div className="flex items-start gap-1.5">
                      <Icon name="file-up" size={13} className="mt-px shrink-0 text-slate-400" />
                      <span className="min-w-0 break-words font-medium text-slate-800">{t("Lead ka apna text (CSV ke subject/body se)", "The lead's own text (CSV subject/body)")}</span>
                      <Info title={t("Lead ka apna text", "The lead's own text")} size={13}
                        text={t(
                          "Import file mein is lead ke liye subject aur body dono diye the, isliye template ya AI ki jagah wahi text use hua. Uske placeholders lead ki jaankari se bhare gaye aur same rules check hue (words, sawaal, koi link / CAPS nahi). Padh ke Approve, Edit ya Reject karo.",
                          "The import file gave both a subject and a body for this lead, so that text was used instead of a template or the AI. Its placeholders were filled from the lead's details and the same rules were checked (words, a question, no links / CAPS). Read it, then Approve, Edit or Reject.",
                        )} />
                    </div>
                  </div>
                ) : tpl ? (
                  <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                    <div className="flex items-start gap-1.5">
                      <Icon name="file" size={13} className="mt-px shrink-0 text-slate-400" />
                      <span className="min-w-0 break-words">
                        {t("Template se bani:", "Written from template:")} <span className="font-medium text-slate-800">{templateLabel(s, tpl.id)}</span>
                        {bySite && lead && <> <Badge v="site" label={siteGroup(own.has, t)} tone={own.has ? "sky" : "slate"} dot={false} /></>}
                        {lead && <span className="text-slate-500"> · {siteText(own, t)}</span>}
                      </span>
                      <Info title={t("Template se bani mail", "A mail made from a template")} size={13}
                        text={t(
                          "Is campaign mein AI mail nahi likhta: ye mail Settings ke ‘Email templates’ wale fixed template se bani hai. ‘Website ke hisaab se templates’ wale campaign mein har group (Bina website / Website hai) ke 1-3 chune hue templates baari-baari se lagte hain. Facebook / Instagram / Google Maps / directory / booking / delivery link, ya wixsite.com jaisa free builder page, apni website nahi maana jaata. {{business}}, {{city}}, {{reviews}} jaise placeholders lead ki jaankari se bhare gaye; jo jaankari nahi thi, wahan template ka |fallback text aaya. Sirf {{observation}} ka koi fallback nahi: wo na ho to mail ‘Text chahiye’ mein rukti hai.",
                          "In this campaign the AI does not write the mails: this mail was made from a fixed template in Settings → ‘Email templates’. In a ‘Templates by website’ campaign, each group (No website / Has a website) takes turns between its 1-3 ticked templates. A Facebook / Instagram / Google Maps / directory / booking / delivery link, or a free builder page such as wixsite.com, does not count as their own website. Placeholders like {{business}}, {{city}} and {{reviews}} were filled from the lead's details; where a detail was missing, the template's |fallback text was used. Only {{observation}} has no fallback: without it the mail waits under ‘Needs your text’.",
                        )} />
                    </div>
                    {offTag && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-amber-700">
                        <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
                        <span className="min-w-0 break-words">{own.has
                          ? t(`Dhyan do: ye template ‘${forText(tpl.for, t)}’ ke liye likha hai, par is lead ki apni website hai. Padh ke dekho ki text is lead pe theek baithta hai.`, `Note: this template is written for ‘${forText(tpl.for, t)}’, but this lead has its own website. Check that the text fits this lead.`)
                          : t(`Dhyan do: ye template ‘${forText(tpl.for, t)}’ ke liye likha hai, par is lead ki apni website nahi hai. Padh ke dekho ki text is lead pe theek baithta hai.`, `Note: this template is written for ‘${forText(tpl.for, t)}’, but this lead has no website of its own. Check that the text fits this lead.`)}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      <Icon name="bot" size={13} className="text-slate-400" />{t("AI ko ye pata tha", "What the AI knew")}
                      <Info title={t("AI ko ye pata tha", "What the AI knew")} size={13}
                        text={t(
                          "Mail likhte waqt AI ko is lead ke baare mein sirf yahi baatein di gayi thi, aur wo sirf inhi ka use kar sakta hai. Website ka title / description sirf ye samajhne ke liye hai ki business kya karta hai: AI kabhi website pe comment nahi karta (jaise ‘maine aapka homepage dekha’). Agar mail mein koi aisi baat hai jo is list mein nahi hai, to use Edit karo ya Reject karo.",
                          "When writing the mail, the AI was given only these points about this lead, and it may use only them. The website title / description is only there to understand what the business does: the AI never comments on the website (like ‘I saw your homepage’). If the mail says anything that is not in this list, Edit or Reject it.",
                        )} />
                    </div>
                    {known.length ? (
                      <dl className="mt-2 grid gap-y-2 text-xs sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-1">
                        {known.map((k) => (
                          <div key={k.key} className="min-w-0 sm:contents">
                            <dt className="text-slate-500 sm:whitespace-nowrap">{k.label}</dt>
                            <dd className="min-w-0 break-words text-slate-800">{k.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="mt-2 text-xs text-slate-700">
                        {lead
                          ? t("Email address ke siwa is lead ke baare mein kuch nahi pata tha.", "Nothing was known about this lead except the email address.")
                          : t("Is mail ka lead nahi mila.", "This mail's lead was not found.")}
                      </p>
                    )}
                    {(site || guessed) && (
                      <div className="mt-2 space-y-1 border-t border-slate-200/70 pt-2 text-xs">
                        {site && <p className="flex items-start gap-1.5 text-slate-500"><Icon name="globe" size={12} className="mt-0.5 shrink-0 text-slate-400" /><span className="min-w-0 break-words">{site}</span></p>}
                        {guessed && (
                          <p className="flex items-start gap-1.5 text-amber-700">
                            <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
                            <span className="min-w-0">{t(
                              "AI ko nahi pata tha ki ye business kya karta hai: mail mein unke kaam ke baare mein koi baat nahi honi chahiye.",
                              "The AI did not know what this business does: the mail must not say anything about their work.",
                            )}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* left: the mail exactly as it goes out, in its language; right: always the same mail in English, only for me */}
                <div className="grid gap-4 md:grid-cols-2">
                  <MailPreview label={aiFailed ? t("Draft (abhi khaali)", "Draft (empty for now)") : t("Mail (jaisi jayegi)", "Mail (as it will be sent)")} subject={m.subject} text={fullText(s, m.body, m.language, list?.sourceNote || "")}
                    footer={s.signatureLogo ? (
                      <div className="border-t border-slate-100 px-3 py-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`data:image/png;base64,${LOGO_PNG_BASE64}`} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt={t("Signature ka logo", "Signature logo")} className="h-auto max-w-full" />
                        <div className="mt-1 text-2xs text-slate-400">{t("Ye logo signature ke saath mail mein judta hai", "This logo is added to the mail with the signature")}</div>
                      </div>
                    ) : undefined} />
                  {/* a draft still waiting for my text gets its English only after I save that text (translateMessage refuses it) */}
                  {needsText && en.kind !== "same"
                    ? (
                      <div className="min-w-0">
                        <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400"><Icon name="globe" size={12} />English translation</div>
                        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs leading-relaxed text-slate-500">
                          <Icon name="pencil" size={16} className="mx-auto mb-1.5 text-slate-400" />
                          {t("English translation tab banega jab aap apna text likh ke save karoge.", "The English translation is made once you write and save your text.")}
                        </div>
                      </div>
                    )
                    : <EnglishMail en={en} text={en.kind === "ready" ? fullText(s, en.body, "en", list?.sourceNote || "") : undefined}
                      action={needsText ? undefined : translateMessage.bind(null, m.id)} />}
                </div>
              </div>

              {/* phones: Approve full width, then Edit + New version, then Reject; DraftEditor's form always goes last.
                  A "Text chahiye" draft has no Approve: it must be completed with Edit first */}
              <footer className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:flex sm:flex-wrap sm:items-center sm:px-5">
                {!needsText && <ActionButton action={approveMessage.bind(null, m.id, textKey(m.subject, m.body))} label={t("Approve karo", "Approve")} icon="check" className={`btn-success col-span-2 ${WRAP}`} />}
                <DraftEditor id={m.id} subject={m.subject} body={m.body} language={m.language} businessName={m.businessName || ""} allowCaps={allowCaps} marks={marks} problems={problems} />
                <ActionButton action={regenerateDraft.bind(null, m.id)} label={t("Naya version likho", "Write a new version")} icon="refresh"
                  pendingText={tpl || m.custom ? t("Dobara ban rahi hai…", "Making it again…") : t("AI likh raha hai…", "AI is writing…")} className={`btn ${WRAP}`} />
                <ActionButton action={rejectMessage.bind(null, m.id)} label={t("Reject karo", "Reject")} icon="x" confirmText={t("Dobara dabao: ye lead kabhi mail nahi paayega", "Click again: this lead will never be emailed")}
                  className={`btn col-span-2 text-red-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 sm:ml-auto ${WRAP}`} />
              </footer>
            </article>
          );
        })}

        {/* the ticked cards' checkboxes belong to this bar's form; it sticks to the bottom while the list scrolls */}
        {state === "wait" && ready.length > 1 && (
          <SelectionBar ids={ready.map((m) => m.id)} next={sentHref} nextCta={t("Sent page dekho", "See sent mails")} />
        )}
      </div>

      {n > 0 && state === "text" ? (
        <NextStep tone="amber"
          text={t(
            "Har card pe ‘Text edit karo’ kholo aur jo card pe likha hai wo theek karo ([OBSERVATION] ki jagah apna sach sentence, toote rules, ya poori mail khud likho), phir save karo. Save pe text dobara check hota hai; theek ho to mail ‘Approval baaki’ tab mein chali jayegi, wahan padh ke approve karo.",
            "Open ‘Edit text’ on every card and fix what the card says (your own true sentence in place of [OBSERVATION], the broken rules, or the whole mail yourself), then save. The text is checked again on save; once it passes, the mail moves to the ‘Awaiting approval’ tab: read it there and approve it.",
          )}
          href={qs({ s: "wait" })} cta={t("Approval baaki dekho", "See awaiting approval")} />
      ) : n > 0 && held.length === n && !campHold ? (
        <NextStep tone="amber"
          text={t(
            "In mails ka campaign abhi chal nahi raha: approve kar sakte ho, par ye tabhi jayengi jab Campaign page pe campaign start (ya Resume) karoge. Start karne se koi mail approve nahi hoti.",
            "The campaign for these mails is not running right now: you can approve them, but they go out only once you start (or resume) the campaign on the Campaign page. Starting approves nothing.",
          )}
          href={heldCampaigns.length === 1 ? `/campaigns/${heldCampaigns[0]}` : "/campaigns"}
          cta={heldCampaigns.length === 1 ? t("Campaign kholo", "Open campaign") : t("Campaigns dekho", "See campaigns")} />
      ) : n > 0 && campHold ? (
        <NextStep tone="amber"
          text={t(
            `${campHold.title}. Approve ki hui mails queue mein rahengi aur campaign chalne pe hi jayengi.`,
            `${campHold.title}. Approved mails stay in the queue and go out only once the campaign runs.`,
          )}
          href={`/campaigns/${camp!.id}`} cta={t("Campaign kholo", "Open campaign")} />
      ) : n > 0 ? (
        <NextStep
          text={held.length
            ? t(`${sendLine} Jis card pe campaign ki warning hai, wo mail campaign chalne tak nahi jayegi.`, `${sendLine} A mail whose card shows a campaign warning will not go out until its campaign runs.`)
            : sendLine}
          href={sentHref} cta={s.dryRun ? t("Dry-run mails dekho", "See dry-run mails") : t("Sent page dekho", "See sent mails")} />
      ) : (
        <>
          {/* one primary action per screen: the NextStep below; the empty card only offers a secondary link */}
          <div className="card">
            {tplF && total > 0 ? (
              <EmptyState icon="filter" title={t("Is template filter mein koi mail nahi", "No mails match this template filter")}
                text={t("Doosra template chuno ya filter hatao.", "Pick another template or clear the filter.")}>
                <Link href={qs({ tpl: "" })} className="btn mt-4">{t("Template filter hatao", "Clear the template filter")}<Icon name="x" size={14} /></Link>
              </EmptyState>
            ) : state === "text" ? (
              <EmptyState icon="check-check" title={t("Kisi mail mein aapka text nahi chahiye", "No mail needs your text")}
                text={t(
                  "Jab template {{observation}} maange aur lead ke import mein wo na ho, bhara hua template ya lead ka apna text kisi rule pe fail ho, ya AI mail na likh paye, to mail yahan rukti hai jab tak aap apna text na likho.",
                  "When a template needs {{observation}} and the lead's import has none, the filled template or the lead's own text breaks a rule, or the AI cannot write the mail, the mail waits here until you write your text.",
                )}>
                <Link href={qs({ s: "wait" })} className="btn mt-4">{t("Approval baaki dekho", "See awaiting approval")}<Icon name="arrow-right" size={14} /></Link>
              </EmptyState>
            ) : (
              <EmptyState icon="check-check" title={t("Koi mail approval ke liye nahi ruki", "No mails are waiting for approval")}
                text={textN
                  ? t(`${textN} ${textN === 1 ? "mail" : "mails"} mein pehle aapka text chahiye: ‘Text chahiye’ tab kholo.`, `${textN} ${textN === 1 ? "mail needs" : "mails need"} your text first: open the ‘Needs your text’ tab.`)
                  : t(
                    "Campaign start hone ke baad worker har Ready lead ka draft banata hai (har minute thode-thode); sab yahan ‘Approval baaki’ mein aayengi. Start karne se koi mail approve nahi hoti.",
                    "After a campaign is started, the worker makes a draft for every Ready lead (a few every minute); they all show up here under ‘Awaiting approval’. Starting approves nothing.",
                  )}>
                {textN
                  ? <Link href={qs({ s: "text" })} className="btn mt-4">{t("‘Text chahiye’ dekho", "See ‘Needs your text’")}<Icon name="arrow-right" size={14} /></Link>
                  : <Link href="/campaigns" className="btn mt-4">{t("Campaigns dekho", "See campaigns")}<Icon name="arrow-right" size={14} /></Link>}
              </EmptyState>
            )}
          </div>
          <NextStep
            text={t(
              "Approved mails queue mein hain aur limits ke andar apne aap jaati hain. Kaunsi mail kab aur kisko gayi, wo Sent page pe dekho. Nayi drafts chahiye to Campaigns mein campaign start karo.",
              "Approved mails are in the queue and go out by themselves within the limits. See on the Sent page which mails went out, when and to whom. Need new drafts? Start a campaign in Campaigns.",
            )}
            href={sentHref} cta={t("Bheji gayi mails dekho", "See sent mails")} />
        </>
      )}
    </div>
  );
}
