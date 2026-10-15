import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { C, EVENTS, key, rows, type Lead, type Message, type Reply, type SendLog, type EventRow, type LeadList, type Campaign } from "@/lib/fsdb";
import { Badge, Callout, MailPreview, NextStep, PageHeader, Section, type Tone } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { Info } from "@/components/Info";
import { ActionButton } from "@/components/ActionButton";
import { ToastOnMount } from "@/components/toast";
import { factChips, parseFacts } from "@/components/factChips";
import { fmt } from "@/lib/time";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { approveLead, rejectLead, markCheckedSent, markCheckedNotSent } from "../../actions";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Contact", "Contact") };
}

type Mail = Message & { approved?: boolean };
/** A UI text in both languages; shown with t(x.hi, x.en). */
type Text = { hi: string; en: string };

// history event type -> label, icon, colour
const EV: Record<string, [Text, IconName, Tone]> = {
  draft: [{ hi: "Draft bana (AI ne mail likhi)", en: "Draft created (the AI wrote the mail)" }, "pencil", "slate"],
  edited: [{ hi: "Draft haath se edit hua", en: "Draft edited by hand" }, "pencil", "slate"],
  approved: [{ hi: "Contact approve hua", en: "Contact approved" }, "check", "emerald"],
  rejected: [{ hi: "Contact reject hua", en: "Contact rejected" }, "x", "slate"],
  approved_mail: [{ hi: "Mail approve hui", en: "Mail approved" }, "check-check", "emerald"],
  rejected_mail: [{ hi: "Mail reject hui", en: "Mail rejected" }, "x", "slate"],
  dry_run: [{ hi: "Dry-run: test address pe gayi", en: "Dry-run: sent to the test address" }, "flask", "amber"],
  sending: [{ hi: "Bhejna shuru hua", en: "Sending started" }, "send", "sky"],
  sent: [{ hi: "Mail chali gayi", en: "Mail sent" }, "check-circle", "emerald"],
  smtp_error: [{ hi: "SMTP error aaya", en: "SMTP error" }, "x-circle", "red"],
  skipped: [{ hi: "Skip hua (mail nahi gayi)", en: "Skipped (mail not sent)" }, "ban", "slate"],
  check_manual: [{ hi: "Manual check chahiye", en: "Needs a manual check" }, "alert", "red"],
  manual: [{ hi: "Manual check ke baad mark kiya", en: "Marked after a manual check" }, "user", "indigo"],
  replied: [{ hi: "Reply aaya", en: "Reply received" }, "reply", "violet"],
  opted_out: [{ hi: "Opt-out kiya", en: "Opted out" }, "ban", "orange"],
  auto_reply: [{ hi: "Auto-reply aaya", en: "Auto-reply received" }, "bot", "slate"],
  bounced: [{ hi: "Mail bounce hui", en: "Mail bounced" }, "x-circle", "red"],
};
const DOT: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-500", sky: "bg-sky-50 text-sky-600", amber: "bg-amber-50 text-amber-600", emerald: "bg-emerald-50 text-emerald-600",
  violet: "bg-violet-50 text-violet-600", red: "bg-red-50 text-red-600", orange: "bg-orange-50 text-orange-600", indigo: "bg-indigo-50 text-indigo-600",
};
const MAILED = ["sent", "replied", "bounced", "opted_out", "check_manual"];
const isBounce = (kind: string) => kind === "bounce" || kind === "softbounce";

// History: the app writes its own notes in English. Shown in the UI language; null = the label already says it.
const NOTE = new Map<string, Text | null>([
  ["validated draft created", null],
  ["draft edited by hand", null],
  ["approved after review", null],
  ["rejected after review", null],
  ["mail approved for sending", null],
  ["mail rejected: this lead will not be emailed", { hi: "Is lead ko ab mail nahi jayegi.", en: "This lead will no longer be emailed." }],
  ["marked as sent after manual check", { hi: "Result: mail gayi thi.", en: "Result: the mail was sent." }],
  ["marked as not sent after manual check (never resent automatically)",
    { hi: "Result: mail nahi gayi. Ye apne aap kabhi dobara nahi jayegi.", en: "Result: the mail was not sent. It will never be resent automatically." }],
  ["worker stopped mid-send; never resent automatically",
    { hi: "Bhejte waqt worker ruk gaya, pata nahi mail gayi ya nahi. Ye apne aap kabhi dobara nahi jayegi.", en: "The worker stopped while sending, so it is unclear whether the mail went out. It will never be resent automatically." }],
]);
// "not sent: <reason>" from the worker
const SKIP_WHY = new Map<string, Text>([
  ["blocked", { hi: "Ye address ya business pehle se Ledger mein tha, isliye nahi bheji.", en: "This address or business was already in the Ledger, so it was not sent." }],
  ["suppressed", { hi: "Address ya domain Block List mein hai, isliye nahi bheji.", en: "The address or domain is on the Block list, so it was not sent." }],
  ["lost", { hi: "Bhejte waqt status badal gaya (jaise campaign ruka), isliye abhi nahi bheji.", en: "The status changed while sending (e.g. the campaign was paused), so it was not sent for now." }],
]);
// "<kind>: <server reply>" from the worker
const SMTP_WHY = new Map<string, Text>([
  ["retry", { hi: "Server ne abhi mana kiya. 3 koshish tak agle sending din dobara try hoti hai.", en: "The server refused it for now. It is retried on the next sending day, up to 3 attempts." }],
  ["hard", { hi: "Address galat ya band hai (pakka bounce), isliye Block List mein chala gaya.", en: "The address is wrong or closed (hard bounce), so it was added to the Block list." }],
  ["pause", { hi: "Login, limit ya policy ki problem. Saari sending apne aap rok di gayi.", en: "A login, limit or policy problem. All sending was paused automatically." }],
  ["uncertain", { hi: "Pata nahi chala mail gayi ya nahi. Manual check chahiye.", en: "Could not tell whether the mail went out. Needs a manual check." }],
]);
// errors the app itself stores on a message; anything else is the SMTP server's reply, shown as it is
const APP_ERR = new Map<string, Text>([
  ["worker stopped mid-send", { hi: "Bhejte waqt worker ruk gaya (pata nahi mail gayi ya nahi)", en: "The worker stopped while sending (unclear whether the mail went out)" }],
  ["address or business already in the contacted ledger", { hi: "Ye address ya business pehle se Ledger mein tha", en: "This address or business was already in the Ledger" }],
  ["unknown result", { hi: "Server se koi saaf jawab nahi aaya", en: "No clear answer from the server" }],
]);
const errText = (e: string, t: T) => {
  const x = APP_ERR.get(e);
  return x ? t(x.hi, x.en) : <span className="font-mono">{e}</span>;
};

/** Text under a history event: the note in the UI language (or nothing) and the server reply apart, so it shows only once. */
function eventDetail(e: EventRow, t: T): { note?: string; server?: string } {
  const d = (e.detail || "").trim();
  if (!d) return {};
  if (NOTE.has(d)) { const x = NOTE.get(d); return { note: x ? t(x.hi, x.en) : undefined }; }
  switch (e.type) {
    case "sending": { const n = /^attempt (\d+)$/.exec(d); return { note: n ? t(`Koshish ${n[1]}`, `Attempt ${n[1]}`) : d }; }
    case "skipped": { const r = /^not sent: (\w+)$/.exec(d); const why = r && SKIP_WHY.get(r[1]); return { note: why ? t(why.hi, why.en) : d }; }
    case "smtp_error": { const r = /^(\w+): ([\s\S]*)$/.exec(d); const why = r && SMTP_WHY.get(r[1]); return r && why ? { note: t(why.hi, why.en), server: r[2] } : { server: d }; }
    case "dry_run": return { server: d.replace(/^delivered to test address:\s*/, "") };
    case "sent": return { server: d };
    case "replied": case "auto_reply": case "bounced": return { note: `Subject: ${d}` };
    case "opted_out": return { note: t(`Unhone likha: "${d}"`, `They wrote: "${d}"`) };
    default: return { note: d };
  }
}

/** What the ledger entry means for this address right now. */
function ledgerNote(status: string, manualCheck: boolean, t: T) {
  if (status === "refused_will_retry") return t(
    "Server ne abhi mana kiya. Yahi mail agle sending din dobara try hogi (zyada se zyada 3 baar). Koi doosri mail kabhi nahi jayegi.",
    "The server refused it for now. The same mail is retried on the next sending day (up to 3 times). No other mail will ever be sent.");
  if (status === "uncertain") return t(
    `Pata nahi mail gayi ya nahi${manualCheck ? ", upar mark karo" : ""}. Ye dobara kabhi apne aap nahi jayegi.`,
    `Unclear whether the mail went out${manualCheck ? "; mark it above" : ""}. It will never be resent automatically.`);
  return t("Ab is address pe kabhi dobara mail nahi jayegi.", "This address will never be emailed again.");
}

/** Label + value. Phone: one row (label left, value right) like a native list. Bigger screens: label above value in a grid. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-slate-100 py-2.5 sm:block sm:border-0 sm:py-0">
      <div className="shrink-0 text-xs font-medium text-slate-400 sm:mb-0.5">{label}</div>
      <div className="min-w-0 break-words text-right text-sm text-slate-800 sm:text-left">{children}</div>
    </div>
  );
}

function pretty(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

type Next = { text: string; href?: string; cta?: string; tone?: "indigo" | "emerald" | "amber" };
function nextFor(l: Lead, m: Mail | null, campHref: string, t: T): Next {
  const sentMails = t("Bheji gayi mails dekho", "See sent mails");
  const otherContacts = t("Baaki contacts dekho", "See other contacts");
  switch (l.status) {
    case "needs_review": return {
      text: t("Upar se Approve ya Reject karo. Approve karne pe ye contact campaign ke saath mail paayega.",
        "Approve or reject it above. Once approved, this contact gets a mail with the campaign."), tone: "amber" };
    case "check_manual": return {
      text: t("Mailbox ka Sent folder check karke upar mark karo ki mail gayi thi ya nahi.",
        "Check the Sent folder in your mailbox, then mark above whether the mail went out."), tone: "amber" };
    case "ready":
      if (!l.campaignId) return {
        text: t("Ye contact ready hai par kisi campaign mein nahi hai. Iski list se campaign banao, tabhi ise mail jayegi.",
          "This contact is ready but not in any campaign. Create a campaign from its list; only then will it get a mail."),
        href: "/campaigns", cta: t("Campaign mein daalo", "Add to a campaign") };
      // no draft yet: the Approve page has nothing for this contact, the campaign page shows whether it is running
      if (!m) return {
        text: t("Campaign chalne pe AI iski mail likhega, phir wo Approve page pe aayegi. Campaign chal raha hai ya nahi, campaign page pe dekho.",
          "While the campaign runs, the AI writes its mail, and then it appears on the Approve page. The campaign page shows whether the campaign is running."),
        href: campHref, cta: t("Campaign kholo", "Open campaign") };
      if (m.status !== "ready") return {
        text: t("Is mail ko bhejne ka kaam chal raha hai. Worker apne aap try karega, result Bheji Gayi Mails mein dikhega.",
          "This mail is being sent. The worker will try on its own; the result will show up in Sent mails."),
        href: "/sent", cta: sentMails };
      // approved mails are not on the Approve page any more (it lists only approved == false)
      if (m.approved === true) return m.dryRunDone
        ? {
          text: t("Ye mail approve hai aur DRY-RUN mein test address pe ja chuki hai. LIVE on hone ke baad sending window mein ye lead ko apne aap jayegi.",
            "This mail is approved and already went to the test address in DRY-RUN. Once LIVE is on, it goes to the lead automatically in the sending window."),
          href: "/sent", cta: sentMails }
        : {
          text: t("Mail approve ho chuki hai. Sending window mein worker ise apne aap bhejega (DRY-RUN mode mein sirf aapke test address pe).",
            "The mail is approved. The worker sends it automatically in the sending window (in DRY-RUN mode only to your test address)."),
          href: "/sent", cta: sentMails };
      return {
        text: t("Iski mail ban chuki hai. Approve page pe padh ke approve karo, phir sending window mein worker ise bhej dega.",
          "Its mail is ready. Read and approve it on the Approve page, then the worker sends it in the sending window."),
        href: "/review", cta: t("Approve page kholo", "Open Approve page") };
    case "sent": return {
      text: t("Mail chali gayi. Reply aaya to Replies page pe dikhega aur status 'Reply aaya' ho jayega.",
        "The mail went out. If they reply, it shows up on the Replies page and the status changes to 'Replied'."),
      href: "/replies", cta: t("Replies dekho", "See replies"), tone: "emerald" };
    case "replied": return {
      text: t("Is lead ne jawab diya hai. Jawab apne mailbox (Hostinger webmail) se do.",
        "This lead has replied. Answer from your own mailbox (Hostinger webmail)."),
      href: "/replies", cta: t("Replies dekho", "See replies"), tone: "emerald" };
    case "bounced": return {
      text: t("Ye address bounce hua (galat ya band hai). Ye block list mein chala gaya, ab ise kabhi mail nahi jayegi.",
        "This address bounced (wrong or closed). It was added to the block list and will never be emailed again."),
      href: "/contacts", cta: otherContacts };
    case "opted_out": return {
      text: t("Is lead ne mana kar diya (opt-out). Ye block list mein hai, ab ise kabhi mail nahi jayegi.",
        "This lead said no (opted out). It is on the block list and will never be emailed again."),
      href: "/contacts", cta: otherContacts };
    default: return {
      text: t("Is contact ko ab koi mail nahi jayegi. Baaki contacts dekho.", "This contact will not get any more mail. See the other contacts."),
      href: "/contacts", cta: t("Contacts pe wapas jao", "Back to contacts") };
  }
}

export default async function Contact({ params }: { params: Promise<{ id: string }> }) {
  const { t, lang } = await getT();
  const id = decodeURIComponent((await params).id);
  const ld = await C.leads.doc(id).get();
  if (!ld.exists) notFound();
  const l = { id, ...ld.data() } as Lead;
  const [md, list, camp, ledger, replySnap, eventSnap, sendSnap] = await Promise.all([
    C.messages.doc(id).get(), C.lists.doc(l.listId).get(), l.campaignId ? C.campaigns.doc(l.campaignId).get() : null, C.contacted.doc(key(l.email)).get(),
    C.replies.where("leadId", "==", id).get(), C.leads.doc(id).collection(EVENTS).orderBy("at").get(), C.sendLogs.where("leadId", "==", id).get(),
  ]);
  const m = md.exists ? ({ id, ...md.data() } as Mail) : null;
  const replies = rows<Reply>(replySnap).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const events = rows<EventRow>(eventSnap);
  const sends = rows<SendLog>(sendSnap).sort((a, b) => a.at.localeCompare(b.at));
  const ls = list.data() as LeadList | undefined;
  const cn = camp?.exists ? (camp.data() as Campaign).name : "—";
  const campHref = l.campaignId && camp?.exists ? `/campaigns/${l.campaignId}` : "/campaigns";
  const lg = ledger.exists ? { status: String(ledger.get("status") || ""), at: ledger.get("at") as string | undefined } : null;
  const facts = l.facts ? factChips(parseFacts(l.facts), lang) : [];
  const serverReply = t("Server ka jawab:", "Server reply:");

  const site = l.website?.trim() || "";
  const siteUrl = /^https?:\/\/\S+$/i.test(site) ? site : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(site) ? `https://${site}` : null;
  const mailed = MAILED.includes(l.status) || !!m?.sentAt;
  // once the mail went out, an error left from an earlier attempt is history, not the reason
  const wentOut = !!m && (m.status === "sent" || !!m.sentAt);

  // One send is stored twice: a send log and a sent / smtp_error / dry_run event with the same server reply.
  // Show it once, as the event; keep only the send logs without a twin (e.g. a failed dry run).
  const twins = new Set<string>();
  const loneSends = sends.filter((s) => {
    if (s.dryRun && !s.ok) return true;
    const type = s.dryRun ? "dry_run" : s.ok ? "sent" : "smtp_error";
    const at = Date.parse(s.at);
    const reply = (s.response || "").slice(0, 200);
    const ev = events.find((x) => !twins.has(x.id) && x.type === type && Math.abs(Date.parse(x.at) - at) < 5 * 60000 && (x.detail || "").includes(reply));
    if (ev) twins.add(ev.id);
    return !ev;
  });

  // events and SMTP attempts in one timeline, oldest first
  type Item = { k: string; at: string; label: string; icon: IconName; tone: Tone; badge?: ReactNode; note?: string; server?: string };
  const items: Item[] = [
    ...events.map((e): Item => {
      const raw = e.type.replace(/_/g, " ");
      const [text, icon, tone]: [Text, IconName, Tone] = EV[e.type] || [{ hi: raw, en: raw }, "dot", "slate"];
      return { k: "e" + e.id, at: e.at, label: t(text.hi, text.en), icon, tone, ...eventDetail(e, t) };
    }),
    ...loneSends.map((s): Item => ({
      k: "s" + s.id, at: s.at, label: s.dryRun ? "SMTP (dry-run)" : "SMTP", icon: "server", tone: s.ok ? "emerald" : "red",
      badge: <Badge v={s.ok ? "sent" : "failed"} />, note: t(`Kisko: ${s.to}`, `To: ${s.to}`), server: s.response,
    })),
  ].sort((a, b) => (a.at || "").localeCompare(b.at || ""));

  return (
    <div className="space-y-4">
      <PageHeader
        title={l.businessName || l.email}
        back={{ href: "/contacts", label: "Contacts" }}
        info={t("Is contact ki poori kahani ek jagah: basic jaankari, AI ki likhi mail, aaye hue jawab aur har step ki history. Agar upar koi laal ya peela box dikhe to pehle wahi kaam karo.",
          "This contact's whole story in one place: basic details, the AI-written mail, replies received and the history of every step. If there is a red or yellow box at the top, deal with that first.")}
        sub={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">{l.businessName && <span className="break-all">{l.email}</span>}<Badge v={l.status} /></span>}
      />

      {l.status === "needs_review" && (
        <Callout tone="warn" title={t("Ye contact aapke review ke liye ruka hai", "This contact is waiting for your review")}
          action={<>
            <ActionButton action={approveLead.bind(null, id)} label={t("Approve karo", "Approve")} icon="check" className="btn-success flex-1 sm:flex-none" okTitle={t("Contact approve ho gaya", "Contact approved")}
              next={l.campaignId ? campHref : "/campaigns"} nextCta={l.campaignId ? t("Campaign kholo", "Open campaign") : t("Campaign banao", "Create campaign")} />
            <ActionButton action={rejectLead.bind(null, id)} label={t("Reject karo", "Reject")} icon="x" className="btn flex-1 sm:flex-none" confirmText={t("Dobara dabao", "Press again")} okTitle={t("Contact reject ho gaya", "Contact rejected")}
              next="/contacts" nextCta={t("Contacts pe wapas jao", "Back to contacts")} />
          </>}>
          {t("Iska address personal lag raha tha (jaise kisi insaan ka naam), isliye app ne ise khud nahi bheja. Approve karo to ye campaign mein jayega, Reject karo to ise kabhi mail nahi jayegi.",
            "Its address looked personal (like a person's name), so the app did not mail it on its own. Approve it and it goes into the campaign; reject it and it will never be emailed.")}
        </Callout>
      )}
      {l.status === "check_manual" && (
        <>
          <Callout tone="danger"
            title={<>{t("Is mail ka result pakka nahi hai", "This mail's result is uncertain")} <Info size={13} title={t("Kaise check karein?", "How to check?")}
              text={t("Webmail ke Sent folder mein is lead ka email search karo. Haan = status Sent; Nahi = status Fail. Dono mein ye mail dobara kabhi apne aap nahi jayegi.",
                "Search for this lead's email in the Sent folder of your webmail. Yes = status Sent; No = status Failed. Either way, this mail will never be resent automatically.")} /></>}
            action={<>
              <ActionButton action={markCheckedSent.bind(null, id)} label={t("Haan, mail gayi thi", "Yes, it was sent")} icon="check" className="btn w-full sm:w-auto" confirmText={t("Dobara dabao: pakka?", "Sure? Press again")} okTitle={t("Sent mark ho gaya", "Marked as sent")} />
              <ActionButton action={markCheckedNotSent.bind(null, id)} label={t("Nahi gayi (band karo)", "No, not sent (close)")} icon="x" className="btn w-full sm:w-auto" confirmText={t("Dobara dabao: pakka?", "Sure? Press again")} okTitle={t("Not sent mark ho gaya", "Marked as not sent")} />
            </>}>
            {t("Mailbox ka Sent folder check karo. Ye apne aap kabhi dobara nahi jayegi.", "Check the Sent folder in your mailbox. It will never be resent automatically.")}
          </Callout>
          <ToastOnMount kind="warning" title={t("Is contact ka send result pakka nahi", "This contact's send result is uncertain")}
            text={t("Sent folder check karke upar mark karo ki mail gayi thi ya nahi.", "Check the Sent folder, then mark above whether the mail went out.")} once={`manual:${id}`} />
        </>
      )}
      {l.status === "failed" && (
        <Callout tone="danger" title={t("Mail nahi ja payi", "The mail could not be sent")}>
          {m?.error
            ? <span className="block break-words">{t("Wajah:", "Reason:")} {errText(m.error, t)}</span>
            : t("Wajah neeche History mein SMTP ke jawab mein dekho.", "See the SMTP reply under History below for the reason.")}{" "}
          {t("Ye apne aap dobara nahi jayegi.", "It will not be resent automatically.")}
        </Callout>
      )}

      <Section title={t("Jaankari", "Details")} icon="user"
        info={t("Is lead ki basic jaankari jo import ke waqt aayi thi: business, email, website, phone, desh, kis list se aaya aur kis campaign mein hai. Neeche ledger batata hai ki is address ko kabhi mail gayi hai ya nahi.",
          "This lead's basic details from the import: business, email, website, phone, country, which list it came from and which campaign it is in. The ledger below shows whether this address was ever emailed.")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-4 md:grid-cols-3">
          <Row label="Business">{l.businessName || "—"}</Row>
          <Row label="Email"><span className="break-all">{l.email}</span></Row>
          <Row label="Website">
            {siteUrl
              ? <a href={siteUrl} target="_blank" rel="noreferrer" className="link break-all">{site}<Icon name="external" size={12} className="ml-1 inline-block align-[-1px]" /></a>
              : site || "—"}
          </Row>
          <Row label="Phone">{l.phone || "—"}</Row>
          <Row label={t("Desh", "Country")}>{l.country || "—"}</Row>
          <Row label="List">
            {ls?.name || "—"}
            {ls?.sourceNote && <span className="mt-0.5 block text-xs text-slate-500">{t("Kahan se mile:", "Source:")} {ls.sourceNote}</span>}
          </Row>
          <Row label="Campaign">{camp?.exists ? <Link href={`/campaigns/${l.campaignId}`} className="link">{cn}</Link> : cn}</Row>
          <Row label={t("Kab add hua", "Added")}>{fmt(l.createdAt)}</Row>
          <Row label={t("Last update", "Last updated")}>{fmt(l.updatedAt)}</Row>
          <div className="mt-3 flex min-w-0 items-start gap-3 rounded-lg border border-slate-200/70 bg-slate-50/70 px-3 py-2.5 sm:col-span-2 sm:mt-0 md:col-span-3">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${lg ? "bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-600/10" : "bg-slate-100 text-slate-400"}`}><Icon name="shield" size={16} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                {t("Contacted Ledger", "Contacted ledger")}
                <Info size={12} title={t("Contacted Ledger", "Contacted ledger")}
                  text={t("Ledger ek permanent list hai. Jis address ko ek baar mail gayi (ya bhejne ki koshish hui), wo yahan hamesha ke liye likha jata hai, aur use dobara kabhi cold mail nahi jaati.",
                    "The ledger is a permanent list. An address that was mailed once (or where a send was attempted) is recorded here forever and never gets a cold mail again.")} />
              </div>
              {lg ? (
                <>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-800"><Badge v={lg.status} /><span>{t("pehli baar", "first recorded")} {fmt(lg.at)}</span></div>
                  <div className="mt-0.5 text-xs text-slate-500">{ledgerNote(lg.status, l.status === "check_manual", t)}</div>
                </>
              ) : <div className="mt-0.5 text-sm text-slate-800">{t("Abhi contact nahi hua", "Not contacted yet")}</div>}
            </div>
          </div>
        </div>
      </Section>

      {l.facts && (
        <Section title="Homepage facts" icon="globe" sub={t(`Check kiya: ${fmt(l.factsAt)}`, `Checked: ${fmt(l.factsAt)}`)}
          info={t("Homepage ki technical baatein: title, description, HTTPS, mobile pe theek dikhti hai ya nahi, load time, menu/booking/order link, footer ka saal. AI inhi se mail personal banata hai.",
            "Technical facts from the homepage: title, description, HTTPS, whether it looks right on mobile, load time, menu/booking/order links and the footer year. The AI uses them to make the mail personal.")}>
          <div className="flex flex-wrap gap-1.5">
            {facts.map((f, j) => <span key={j} className="max-w-full break-words rounded-md bg-slate-50 px-2 py-0.5 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">{f}</span>)}
          </div>
          <details className="group mt-3">
            <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-xs font-medium text-slate-400 transition hover:text-slate-700">
              <Icon name="chevron-right" size={13} className="transition group-open:rotate-90" />{t("Technical detail", "Technical details")}
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200/70 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700">{pretty(l.facts)}</pre>
          </details>
        </Section>
      )}

      <Section title="Mail" icon="mail"
        actions={m ? (
          <>
            <Badge v={m.status} />
            {m.status === "ready" && m.approved === false && <Badge v="approval" label={t("Approval baaki", "Awaiting approval")} tone="amber" dot={false} />}
            {m.status === "ready" && m.approved === true && <Badge v="approved" label={t("Approve ho gayi", "Approved")} tone="emerald" dot={false} />}
            {m.dryRunDone && <Badge v="dry-run" label={t("Dry-run mein gayi", "Sent in dry-run")} dot={false} />}
          </>
        ) : undefined}
        sub={m ? `${t("Bhasha", "Language")}: ${m.language || "—"} · ${m.sentAt ? t(`Bheji gayi: ${fmt(m.sentAt)}`, `Sent: ${fmt(m.sentAt)}`) : m.status === "retry" && m.nextAttemptAt ? t(`Agli koshish: ${fmt(m.nextAttemptAt)}`, `Next attempt: ${fmt(m.nextAttemptAt)}`) : t("Abhi bheji nahi gayi", "Not sent yet")}` : undefined}
        info={t("Is lead ke liye AI ki likhi mail. Har lead ko sirf ek hi mail jaati hai. 'Approval baaki' = Approve page pe aapka intezaar; 'Approve ho gayi' = sending window mein apne aap jayegi. English translation sirf aapke padhne ke liye hai, lead ko original bhasha wali mail hi jaati hai.",
          "The mail the AI wrote for this lead. Each lead gets only one mail. 'Awaiting approval' = waiting for you on the Approve page; 'Approved' = goes out automatically in the sending window. The English translation is only for you to read; the lead gets the mail in the original language.")}>
        {m ? (
          <div className={`grid gap-4 ${m.bodyEn ? "md:grid-cols-2" : ""}`}>
            <MailPreview label={t("Mail ka text", "Mail text")} subject={m.subject} text={m.body}
              footer={m.error && !wentOut
                ? <div className="break-words border-t border-red-100 bg-red-50/60 px-3 py-2 text-xs text-red-700"><span className="font-semibold">{t("Wajah:", "Reason:")}</span> {errText(m.error, t)}</div>
                : m.smtpResponse ? <div className="break-words border-t border-slate-100 bg-slate-50/70 px-3 py-2 text-xs text-slate-500"><span className="font-medium">{serverReply}</span> <span className="font-mono">{m.smtpResponse}</span></div> : undefined} />
            {m.bodyEn && <MailPreview label="English translation" tone="translation" subject={m.subjectEn || undefined} text={m.bodyEn} />}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            {t("Is contact ke liye abhi mail nahi bani. Campaign chalne pe AI iski mail likhega aur wo Approve page pe aayegi.",
              "No mail has been written for this contact yet. While the campaign runs, the AI writes its mail and it appears on the Approve page.")}
          </p>
        )}
      </Section>

      {(replies.length > 0 || mailed) && (
        <Section title={t("Aaye hue jawab", "Replies received")} icon="inbox"
          sub={replies.length ? t(`${replies.length} mail aayi`, replies.length === 1 ? "1 mail received" : `${replies.length} mails received`) : undefined}
          info={t("Is lead se aayi mails: reply, opt-out, bounce ya auto-reply. Inbox har 10 minute mein apne aap sync hota hai. Opt-out aur bounce wale address apne aap block list mein chale jaate hain.",
            "Mails from this lead: replies, opt-outs, bounces or auto-replies. The inbox syncs automatically every 10 minutes. Opted-out and bounced addresses are added to the block list automatically.")}>
          {replies.length ? (
            <div className="divide-y divide-slate-100">
              {replies.map((r) => (
                <div key={r.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <Badge v={r.kind} />
                    <span className="break-all font-medium text-slate-700">{r.fromEmail}</span>
                    <span className="text-slate-400">{fmt(r.receivedAt)}</span>
                  </div>
                  <div className={`grid gap-4 ${r.bodyEn ? "md:grid-cols-2" : ""}`}>
                    <MailPreview label={isBounce(r.kind) ? t("Bounce report (mail server ka jawab)", "Bounce report (mail server reply)") : t("Unka jawab", "Their reply")} subject={r.subject ?? ""} text={r.body.slice(0, 3000)} />
                    {r.bodyEn && <MailPreview label="English translation" tone="translation" text={r.bodyEn} />}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              {t("Abhi koi jawab nahi aaya. Reply aate hi yahan aur Replies page pe dikhega.", "No reply yet. A reply shows up here and on the Replies page as soon as it arrives.")}
            </p>
          )}
        </Section>
      )}

      <Section title="History" icon="history" sub={t("Is contact ke saath kya-kya hua, purane se naye ki taraf", "Everything that happened with this contact, oldest first")}
        info={t("Har step ka record: draft kab bana, kisne approve kiya, SMTP server ne kya jawab diya, reply ya bounce kab aaya. Koi problem ho to wajah yahin milegi.",
          "A record of every step: when the draft was created, who approved it, what the SMTP server replied, when a reply or bounce came in. If something went wrong, the reason is here.")}>
        {items.length ? (
          <ol>
            {items.map((it, i) => (
              <li key={it.k} className="relative flex gap-3 pb-5 last:pb-0">
                {i < items.length - 1 && <span className="absolute bottom-0 left-[13px] top-7 w-px bg-slate-200" aria-hidden="true" />}
                <span className={`relative grid h-7 w-7 shrink-0 place-items-center rounded-full ring-4 ring-white ${DOT[it.tone]}`}><Icon name={it.icon} size={13} /></span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-slate-900">{it.label}</span>
                    {it.badge}
                    <span className="text-xs text-slate-400">{fmt(it.at)}</span>
                  </div>
                  {(it.note || it.server) && (
                    <div className="mt-1 space-y-0.5 break-words text-xs leading-relaxed text-slate-500">
                      {it.note && <p>{it.note}</p>}
                      {it.server && <p><span className="font-medium text-slate-600">{serverReply}</span> <span className="font-mono">{it.server}</span></p>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-500">
            {t("Abhi koi history nahi. Draft banne, approve hone ya mail jaane pe yahan record aayega.", "No history yet. A record appears here when a draft is created, approved or sent.")}
          </p>
        )}
      </Section>

      <NextStep {...nextFor(l, m, campHref, t)} />
    </div>
  );
}
