import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { C, EVENTS, key, rows, type Lead, type Message, type Reply, type SendLog, type EventRow, type LeadList, type Campaign } from "@/lib/fsdb";
import { Badge, Callout, MailPreview, NextStep, PageHeader, Section, type Tone } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { Info } from "@/components/Info";
import { ActionButton } from "@/components/ActionButton";
import { EnglishMail } from "@/components/EnglishMail";
import { ToastOnMount } from "@/components/toast";
import { knownItems, parseFacts, siteNote } from "@/components/factChips";
import { forText, siteGroup, siteText } from "@/components/siteText";
import { fmt } from "@/lib/time";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { fullText } from "@/lib/compose";
import { englishOf } from "@/lib/english";
import { LANGS } from "@/lib/lang";
import { knowsWhatTheyDo } from "@/lib/leadinfo";
import { getSettings, type Settings } from "@/lib/settings";
import { isTemplateId, missingMark, templateForLead, templateLabel, templateOf, templatesForLead, tplNo, type TemplateId } from "@/lib/templates";
import { siteStatus } from "@/lib/website";
import { ruleText } from "@/app/settings/template-check";
import { approveLead, rejectLead, markCheckedSent, markCheckedNotSent, translateMessage } from "../../actions";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Contact", "Contact") };
}

/** When it goes out, the sender saves the exact text (sentText). */
type Mail = Message & { approved?: boolean; sentText?: string };
// the footer source the sender uses when the list has no "Kahan se mile" note (same fallback as sender.ts)
const NO_SOURCE = "a public business directory";

/** Same labels as the Campaign page: the saved text of a mail that went out (or may have), else today's build of it. */
function mailLabel(m: Mail, t: T) {
  if (m.sentText) return m.status === "sent" || m.status === "bounced" ? t("Mail jo gayi", "Mail as sent") : t("Mail jo bhejne ki koshish hui", "Mail we tried to send");
  if (m.status === "needs_text") return t("Draft (aapka text baaki)", "Draft (your text missing)");
  return ["ready", "sending", "retry"].includes(m.status) ? t("Mail (jaisi jayegi)", "Mail (as it will go out)") : t("Mail (footer aaj ki settings se)", "Mail (footer from today's settings)");
}

/** The marks a "Text chahiye" draft shows where my words are missing: "[OBSERVATION]". */
const marksOf = (m: Mail) => (m.missing?.length ? m.missing : ["observation"]).map(missingMark).join(", ");
/** A "Text chahiye" draft that misses a detail like [OBSERVATION] (older ones have no missing / problems: that was the only reason then). */
const missesPart = (m: Mail) => !!m.missing?.length || !m.problems?.length;
/** The Approve page tab where a "Text chahiye" draft is edited, filtered to its campaign. */
const textHref = (m: Mail) => `/review?s=text${m.campaignId ? `&c=${m.campaignId}` : ""}`;

/** "4.8 ★ · 312 reviews": the Google rating and review count as the file gave them (a bare number gets its star / word). */
function googleLine(rating: string | null | undefined, reviews: string | null | undefined, t: T) {
  const r = (rating || "").trim(), n = (reviews || "").trim();
  return [
    r && (/^\d+(?:[.,]\d+)?$/.test(r) ? `${r} ★` : r),
    n && (/^\d[\d\s.,]*$/.test(n) ? t(`${n} reviews`, `${n} reviews`) : n),
  ].filter(Boolean).join(" · ");
}

/** Does this template ask for {{observation}} (which never gets a stand-in)? */
const needsObservation = (s: Settings, id: TemplateId) => {
  const x = templateOf(s, id);
  return /\{\{\s*observation\s*(\||\}\})/i.test(`${x.subject}\n${x.body}`);
};
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
// a draft in a template campaign: no AI involved (a lead's campaign, and so its mail type, never changes)
const DRAFT_TPL: Text = { hi: "Draft bana (template se mail bani)", en: "Draft created (made from the template)" };

/**
 * A "draft" event as lib/drafts.ts writes it: "validated draft created" or "draft waiting for my text" (with " (rules: a; b)"
 * when the text broke draft rules or the AI failed), then " from tplN" or " from the lead's own text" (older events have no
 * "from": a template campaign's draft came from its template, else the AI's).
 */
function draftEvent(detail: string | undefined, tplCampaign: boolean, s: Settings, t: T): { label: string; tone: Tone; note?: string } {
  const d = /^(draft waiting for my text|validated draft created)(?: \(rules: ([\s\S]*)\))?(?: from (\S+|the lead's own text))?$/.exec((detail || "").trim());
  const src = d?.[3];
  const label = isTemplateId(src)
    ? t(`Draft bana (${templateLabel(s, src)} se)`, `Draft created (from ${templateLabel(s, src)})`)
    : src
      ? t("Draft bana (lead ka apna text, CSV se)", "Draft created (the lead's own text from the CSV)")
      : tplCampaign ? t(DRAFT_TPL.hi, DRAFT_TPL.en) : t(EV.draft[0].hi, EV.draft[0].en);
  if (d?.[1] !== "draft waiting for my text") return { label, tone: "slate" };
  // the broken rules (the event keeps only the first 200 characters of them)
  const rules = d[2] ? d[2].split("; ").map((e) => ruleText(e, t)).join(" · ") : "";
  return {
    label, tone: "amber",
    note: !rules
      ? t("Text chahiye: template ko {{observation}} chahiye tha, par is lead ki observation nahi thi. App wahan kuch nahi bharta; wo hissa aap khud likhoge.",
        "Needs your text: the template needs {{observation}}, but this lead had none. The app fills in nothing there; you write that part yourself.")
      : !src && !tplCampaign
        ? t(`Text chahiye: AI 5 koshish mein sahi mail nahi likh paya. Aakhri wajah: ${rules}`, `Needs your text: the AI could not write a valid mail in 5 tries. Last reason: ${rules}`)
        : t(`Text chahiye: bhara hua text draft ke rules pe fail hua: ${rules}. Aap edit karke theek karoge.`, `Needs your text: the filled text broke the draft rules: ${rules}. You fix it by editing.`),
  };
}
// the two sides of the mail section
const SIDES: Text = {
  hi: "Left mein wahi mail hai jo lead ko jaati hai (uski bhasha mein); right mein usi mail ka English matlab, sirf aapke check ke liye.",
  en: "The left shows the mail exactly as the lead gets it (in its language); the right shows the same mail's meaning in English, only for you to check.",
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
  ["mail approved by me: in the send queue", { hi: "Aapne khud approve ki: ab send queue mein hai.", en: "Approved by you: now in the send queue." }],
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

/**
 * Label + value. Phone: one row (label left, value right) like a native list. Bigger screens: label above value in a grid.
 * wide: a longer text (e.g. "What they do"), label above it and the full grid width on every screen.
 */
function Row({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  if (wide) return (
    <div className="min-w-0 border-b border-slate-100 py-2.5 sm:col-span-2 sm:border-0 sm:py-0 md:col-span-3">
      <div className="text-xs font-medium text-slate-400 sm:mb-0.5">{label}</div>
      <div className="mt-1 min-w-0 whitespace-pre-line break-words text-sm text-slate-800 sm:mt-0">{children}</div>
    </div>
  );
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
function nextFor(l: Lead, m: Mail | null, cd: Campaign | null, campHref: string, t: T): Next {
  const sentMails = t("Bheji gayi mails dekho", "See sent mails");
  const otherContacts = t("Baaki contacts dekho", "See other contacts");
  const openCamp = t("Campaign kholo", "Open campaign");
  switch (l.status) {
    case "needs_review": return {
      text: t("Upar se Approve ya Reject karo. Approve karne pe campaign iski draft banayega; wo mail bhi aap Approve page pe khud approve karoge.",
        "Approve or reject it above. Once approved, the campaign makes its draft; you approve that mail yourself on the Approve page too."), tone: "amber" };
    case "check_manual": return {
      text: t("Mailbox ka Sent folder check karke upar mark karo ki mail gayi thi ya nahi.",
        "Check the Sent folder in your mailbox, then mark above whether the mail went out."), tone: "amber" };
    case "ready":
      if (!l.campaignId) return {
        text: t("Ye contact ready hai par kisi campaign mein nahi hai. Iski list se campaign banao, tabhi ise mail jayegi.",
          "This contact is ready but not in any campaign. Create a campaign from its list; only then will it get a mail."),
        href: "/campaigns", cta: t("Campaign mein daalo", "Add to a campaign") };
      // no draft yet: the Approve page has nothing for this contact; after Start the worker makes a draft for every Ready lead
      if (!m) {
        if (!cd?.samplesApproved) return {
          text: t("Campaign abhi start nahi hua. Start karne pe worker iski draft banayega, phir wo Approve page pe aayegi. Start se koi mail approve nahi hoti: har mail aap khud approve karoge.",
            "The campaign has not started yet. Once you start it, the worker makes its draft, and then it appears on the Approve page. Starting approves no mail: you approve every mail yourself."),
          href: campHref, cta: openCamp };
        if (cd.status === "paused") return {
          text: t("Campaign ruka hua hai. Dobara chalne pe worker iski draft banayega, phir wo Approve page pe aayegi.",
            "The campaign is paused. When it runs again, the worker makes its draft, and then it appears on the Approve page."),
          href: campHref, cta: openCamp };
        return {
          text: t("Campaign chal raha hai: worker har Ready lead ki draft thodi-thodi karke banata hai (template se ek run mein 50 tak, AI se 3). Iski draft bante hi Approve page pe aayegi; approve aap khud karoge.",
            "The campaign is running: the worker makes a draft for every Ready lead, a batch at a time (up to 50 per run from templates, 3 with the AI). Its draft shows up on the Approve page as soon as it is made; you approve it yourself."),
          href: campHref, cta: openCamp };
      }
      // it waits for my words (a missing detail like [OBSERVATION], a broken rule, or the AI failed) and cannot be approved before
      if (m.status === "needs_text") return {
        text: missesPart(m)
          ? t(`Is mail mein aapka text chahiye. Approve page pe 'Text edit karo' dabao, ${marksOf(m)} ki jagah unki website ki ek asli problem likho jo aapne khud dekhi, aur save karo. Phir padh ke khud approve karo.`,
            `This mail needs your text. On the Approve page press 'Edit text', replace ${marksOf(m)} with one real problem on their website that you saw yourself, and save. Then read it and approve it yourself.`)
          : t("Is mail mein aapka text chahiye: wajah upar Mail mein hai. Approve page pe 'Text edit karo' dabao, mail theek karo aur save karo. Phir padh ke khud approve karo.",
            "This mail needs your text: the reason is in Mail above. On the Approve page press 'Edit text', fix the mail and save. Then read it and approve it yourself."),
        href: textHref(m), cta: t("Text likho", "Write the text"), tone: "amber" };
      if (m.status !== "ready") return {
        text: t("Is mail ko bhejne ka kaam chal raha hai. Worker apne aap try karega, result Bheji Gayi Mails mein dikhega.",
          "This mail is being sent. The worker will try on its own; the result will show up in Sent mails."),
        href: "/sent", cta: sentMails };
      // only a running, started campaign sends: in a draft (not started) or paused one, approving sends nothing yet
      if (cd && (cd.status === "paused" || !cd.samplesApproved)) {
        const paused = cd.status === "paused";
        return m.approved === true
          ? {
            text: paused
              ? t("Mail approve ho chuki hai, par campaign ruka hua hai. Campaign resume hone ke baad hi ye jayegi.", "The mail is approved, but the campaign is paused. It goes out only after you resume the campaign.")
              : t("Mail approve ho chuki hai, par campaign abhi start nahi hua. Campaign start hone ke baad hi ye jayegi.", "The mail is approved, but the campaign has not been started. It goes out only after you start the campaign."),
            href: campHref, cta: openCamp, tone: "amber" }
          : {
            text: paused
              ? t("Iski mail ban chuki hai, par campaign ruka hua hai. Approve kar sakte ho, par campaign resume hone tak koi mail nahi jayegi. Resume khud kuch approve nahi karta.",
                "Its mail is ready, but the campaign is paused. You can approve it, but nothing goes out until you resume the campaign. Resuming approves nothing itself.")
              : t("Iski mail ban chuki hai, par campaign abhi start nahi hua. Approve kar sakte ho, par campaign start hone tak koi mail nahi jayegi. Start khud kuch approve nahi karta.",
                "Its mail is ready, but the campaign has not been started. You can approve it, but nothing goes out until you start the campaign. Starting approves nothing itself."),
            href: campHref, cta: openCamp, tone: "amber" };
      }
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
        href: m.campaignId ? `/review?c=${m.campaignId}` : "/review", cta: t("Approve page kholo", "Open Approve page") };
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
  const [md, list, camp, ledger, replySnap, eventSnap, sendSnap, s] = await Promise.all([
    C.messages.doc(id).get(), C.lists.doc(l.listId).get(), l.campaignId ? C.campaigns.doc(l.campaignId).get() : null, C.contacted.doc(key(l.email)).get(),
    C.replies.where("leadId", "==", id).get(), C.leads.doc(id).collection(EVENTS).orderBy("at").get(), C.sendLogs.where("leadId", "==", id).get(),
    getSettings(),
  ]);
  const m = md.exists ? ({ id, ...md.data() } as Mail) : null;
  const replies = rows<Reply>(replySnap).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const events = rows<EventRow>(eventSnap);
  const sends = rows<SendLog>(sendSnap).sort((a, b) => a.at.localeCompare(b.at));
  const ls = list.data() as LeadList | undefined;
  const cd = camp?.exists ? (camp.data() as Campaign) : null;
  const cn = cd ? cd.name : "—";
  const campHref = l.campaignId && camp?.exists ? `/campaigns/${l.campaignId}` : "/campaigns";
  const lg = ledger.exists ? { status: String(ledger.get("status") || ""), at: ledger.get("at") as string | undefined } : null;
  const serverReply = t("Server ka jawab:", "Server reply:");

  const val = (v?: string | null) => (v || "").trim();
  // the lead's own mail from the import file (subject + body columns): used instead of a template or the AI when both are there
  const ownMail = val(l.customSubject) && val(l.customBody) ? { subject: val(l.customSubject), body: val(l.customBody) } : null;
  const ownHalf = !ownMail && !!(val(l.customSubject) || val(l.customBody));
  const custom = m ? !!m.custom : !!ownMail;
  // a template campaign fills a fixed text, so the AI never writes this lead's mail. The draft records its template;
  // an older draft (or no draft yet) gets the one the campaign picks for this lead ("by website": by its own website)
  const own = siteStatus(l.website);
  const forLead = cd && !custom ? templatesForLead(cd, l.website) : null;
  const draftTpl = m?.tplId;
  const tplId = custom ? null : isTemplateId(draftTpl) ? draftTpl : (cd && templateForLead(cd, l.website, draftTpl)?.id) || null;
  const tpl = tplId ? templateOf(s, tplId) : null;
  const tplName = tplId ? templateLabel(s, tplId) : "";
  const bySite = !!forLead?.group;
  // no draft yet and the lead's group has several templates: which one it gets is decided in turn when the draft is made
  const turnIds = !m && forLead && forLead.ids.length > 1 ? forLead.ids : null;
  const tplNames = turnIds ? turnIds.map(tplNo).join(", ") : tplName;
  // no draft yet: will its template ask for an observation this lead does not have? Then the draft waits as "Text chahiye"
  const obsIds = !m && forLead && !val(l.observation) ? forLead.ids.filter((x) => needsObservation(s, x)) : [];
  const waiting = m?.status === "needs_text";
  // "Text chahiye" reasons: the rules the text broke, or (no template, no own text) the AI's last error after 5 tries
  const problems = waiting ? m?.problems || [] : [];
  const aiFailed = problems.length > 0 && !m?.tplId && !m?.custom && !tpl;
  // a template written for the other group (e.g. a "no website" text for a lead with its own website): worth a look before it goes out
  const tplOff = !!tpl && !turnIds && tpl.for !== "any" && (tpl.for === "site") !== own.has && (!m || m.status === "ready" || waiting);
  // right side of the mail: the same mail in English, made from its current text (lib/english.ts)
  const en = m ? englishOf(m) : null;
  const langName = m ? LANGS[m.language] || (m.language || "—").toUpperCase() : "";
  // what the AI may say about this lead: the same list the AI gets (knownFacts in lib/leadinfo.ts)
  const facts = parseFacts(l.facts);
  const known = knownItems(l, facts, lang);
  const siteLine = siteNote(l.website, facts, lang);
  const siteLater = !facts && !!l.website?.trim(); // the website is read before the first AI draft
  const guessed = !knowsWhatTheyDo(known) && !siteLater;
  const google = googleLine(l.rating, l.reviews, t);

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
      if (e.type === "draft") return { k: "e" + e.id, at: e.at, icon: "pencil", ...draftEvent(e.detail, !!tpl, s, t) };
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
        info={t("Is contact ki poori kahani ek jagah: basic jaankari, AI ko iske baare mein kya pata hai, iski mail, aaye hue jawab aur har step ki history. Agar upar koi laal ya peela box dikhe to pehle wahi kaam karo.",
          "This contact's whole story in one place: basic details, what the AI knows about it, its mail, replies received and the history of every step. If there is a red or yellow box at the top, deal with that first.")}
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
        info={t("Is lead ki jaankari jo import ke waqt aayi thi: business, email, website, phone, desh, aur file mein ho to contact ka naam, shehar, business ka type, wo kya karte hain, ek sach baat, Google rating / reviews, observation (unki website ki ek problem) aur lead ka apna mail text. Saath mein ye kis list se aaya aur kis campaign mein hai. Neeche ledger batata hai ki is address ko kabhi mail gayi hai ya nahi.",
          "This lead's details from the import: business, email, website, phone, country and, when the file had them, the contact name, city, type of business, what they do, one true fact, the Google rating / reviews, the observation (one problem on their website) and the lead's own mail text. Also which list it came from and which campaign it is in. The ledger below shows whether this address was ever emailed.")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-4 md:grid-cols-3">
          <Row label="Business">{l.businessName || "—"}</Row>
          {val(l.contactName) && <Row label={t("Contact ka naam", "Contact name")}>{val(l.contactName)}</Row>}
          <Row label="Email"><span className="break-all">{l.email}</span></Row>
          <Row label="Website">
            {siteUrl
              ? <a href={siteUrl} target="_blank" rel="noreferrer" className="link break-all">{site}<Icon name="external" size={12} className="ml-1 inline-block align-[-1px]" /></a>
              : site || "—"}
            {!own.has && own.why === "profile" && <span className="mt-0.5 block text-xs text-slate-500">{siteText(own, t)}</span>}
          </Row>
          <Row label="Phone">{l.phone || "—"}</Row>
          <Row label={t("Desh", "Country")}>{l.country || "—"}</Row>
          {val(l.city) && <Row label={t("Shehar", "City")}>{val(l.city)}</Row>}
          {val(l.category) && <Row label={t("Business ka type", "Type of business")}>{val(l.category)}</Row>}
          {google && <Row label="Google">{google}</Row>}
          <Row label="List">
            {ls?.name || "—"}
            {ls?.sourceNote && <span className="mt-0.5 block text-xs text-slate-500">{t("Kahan se mile:", "Source:")} {ls.sourceNote}</span>}
          </Row>
          <Row label="Campaign">{camp?.exists ? <Link href={`/campaigns/${l.campaignId}`} className="link">{cn}</Link> : cn}</Row>
          <Row label={t("Kab add hua", "Added")}>{fmt(l.createdAt)}</Row>
          <Row label={t("Last update", "Last updated")}>{fmt(l.updatedAt)}</Row>
          {val(l.about) && <Row wide label={t("Kya karte hain", "What they do")}>{val(l.about)}</Row>}
          {val(l.note) && <Row wide label={t("Sach baat", "True fact")}>{val(l.note)}</Row>}
          {val(l.observation) && <Row wide label={t("Observation (website ki ek problem)", "Observation (one problem on their website)")}>{val(l.observation)}</Row>}
          {ownMail && (
            <Row wide label={t("Apna mail text (CSV)", "Own mail text (CSV)")}>
              {/* folded: the full text is in the Mail section once the draft exists */}
              <details className="group">
                <summary className="inline-flex max-w-full cursor-pointer select-none items-baseline gap-1 transition hover:text-indigo-700">
                  <Icon name="chevron-right" size={13} className="shrink-0 self-center text-slate-400 transition group-open:rotate-90" />
                  <span className="min-w-0 truncate font-medium">{ownMail.subject}</span>
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200/70 bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-700">{ownMail.body}</pre>
              </details>
              <span className="mt-0.5 block text-xs text-slate-500">
                {t("Is lead ko template ya AI ki jagah yahi text jaata hai (wahi rules ke saath).", "This lead gets this text instead of a template or the AI (under the same rules).")}
              </span>
            </Row>
          )}
          {ownHalf && (
            <Row wide label={t("Apna mail text (CSV)", "Own mail text (CSV)")}>
              <span className="text-xs text-amber-700">
                {val(l.customSubject)
                  ? t("File mein sirf apna subject tha, text nahi. Dono chahiye, isliye ye use nahi hota: mail template ya AI se banti hai.", "The file had only an own subject, no text. Both are needed, so it is not used: the mail is made from a template or by the AI.")
                  : t("File mein sirf apna text tha, subject nahi. Dono chahiye, isliye ye use nahi hota: mail template ya AI se banti hai.", "The file had only an own text, no subject. Both are needed, so it is not used: the mail is made from a template or by the AI.")}
              </span>
            </Row>
          )}
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

      {!tpl && !custom && (
        <Section title={t("AI ko kya pata hai", "What the AI knows")} icon="bot"
          sub={l.factsAt ? t(`Website check hui: ${fmt(l.factsAt)}`, `Website checked: ${fmt(l.factsAt)}`) : undefined}
          info={t("AI is lead ke baare mein mail mein sirf yahi baatein likh sakta hai: import file ki jaankari, aur unki apni website ka title / description (sirf ye samajhne ke liye ki wo kya karte hain). AI website pe kabhi comment nahi karta aur jo yahan nahi hai uska andaza nahi lagata. Behtar mail ke liye import file mein contact ka naam, shehar, business ka type, wo kya karte hain aur ek sach baat do.",
            "These are the only points the AI may write about this lead: the details from the import file, and their own website title / description (only to understand what they do). The AI never comments on the website and never guesses anything that is not listed here. For better mails, put the contact name, city, type of business, what they do and one true fact in the import file.")}>
          {known.length ? (
            <dl className="grid gap-y-2.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6 sm:gap-y-2">
              {known.map((k) => (
                <div key={k.key} className="min-w-0 sm:contents">
                  <dt className="text-xs font-medium text-slate-400 sm:whitespace-nowrap sm:pt-0.5">{k.label}</dt>
                  <dd className="mt-0.5 min-w-0 break-words text-sm text-slate-800 sm:mt-0">{k.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-slate-500">
              {t("Email address ke siwa AI ko is lead ke baare mein kuch nahi pata, isliye mail general rahegi.", "Apart from the email address, the AI knows nothing about this lead, so the mail stays general.")}
            </p>
          )}
          {(siteLine || guessed) && (
            <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs">
              {siteLine && (
                <p className="flex items-start gap-1.5 text-slate-500">
                  <Icon name="globe" size={12} className="mt-0.5 shrink-0 text-slate-400" />
                  <span className="min-w-0 break-words">
                    {siteLine}{siteLater && t(". AI ki pehli draft se pehle uska title aur description padha jayega.", ". Its title and description are read before the first AI draft.")}
                  </span>
                </p>
              )}
              {guessed && (
                <p className="flex items-start gap-1.5 text-amber-700">
                  <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">{t("Ye nahi pata ki ye business kya karta hai, isliye AI unke kaam ke baare mein kuch nahi likhta.", "It is not known what this business does, so the AI writes nothing about their work.")}</span>
                </p>
              )}
            </div>
          )}
          {l.facts && (
            <details className="group mt-3">
              <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-xs font-medium text-slate-400 transition hover:text-slate-700">
                <Icon name="chevron-right" size={13} className="transition group-open:rotate-90" />{t("Technical detail", "Technical details")}
              </summary>
              <p className="mt-2 text-xs text-slate-500">{t("Website check ka raw data. AI ko isme se sirf title aur description milte hain.", "Raw data from the website check. The AI gets only the title and description from it.")}</p>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200/70 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700">{pretty(l.facts)}</pre>
            </details>
          )}
        </Section>
      )}

      <Section title="Mail" icon="mail"
        actions={m ? (
          <>
            {/* needs_text: "Text chahiye" / "Needs your text", the same words as everywhere else (STATUS in components/ui.tsx) */}
            <Badge v={m.status} />
            {m.status === "ready" && m.approved === false && <Badge v="approval" label={t("Approval baaki", "Awaiting approval")} tone="amber" dot={false} />}
            {m.status === "ready" && m.approved === true && <Badge v="approved" label={t("Approve ho gayi", "Approved")} tone="emerald" dot={false} />}
            {m.dryRunDone && <Badge v="dry-run" label={t("Dry-run mein gayi", "Sent in dry-run")} dot={false} />}
          </>
        ) : undefined}
        sub={m ? `${tpl ? t(`${tplName} se bani`, `Made from ${tplName}`) : custom ? t("Lead ka apna text (CSV)", "The lead's own text (CSV)") : aiFailed ? t("AI sahi mail nahi likh paya", "The AI could not write it") : t("AI ne likhi", "Written by the AI")} · ${t("Bhasha", "Language")}: ${langName} · ${m.sentAt ? t(`Bheji gayi: ${fmt(m.sentAt)}`, `Sent: ${fmt(m.sentAt)}`) : m.status === "retry" && m.nextAttemptAt ? t(`Agli koshish: ${fmt(m.nextAttemptAt)}`, `Next attempt: ${fmt(m.nextAttemptAt)}`) : t("Abhi bheji nahi gayi", "Not sent yet")}` : undefined}
        info={`${tpl
          ? t(`Is lead ke liye ${tplNames} se bani mail: is campaign mein AI mail nahi likhta.${bySite ? " Campaign website ke hisaab se templates chunta hai: 'Bina website' group ke liye 1-3 aur 'Website hai' group ke liye 1-3; ek group ki leads ko uske templates baari-baari se milte hain, aur har draft pe likha hota hai ki wo kis template se bani." : ""}`,
            `The mail made from ${tplNames} for this lead: in this campaign the AI does not write the mails.${bySite ? " The campaign picks templates by website: 1-3 for the 'No website' group and 1-3 for the 'Has a website' group; the leads of a group get its templates in turn, and every draft says which template it was made from." : ""}`)
          : custom
            ? t("Is lead ki mail uske apne text se bani: import file ke subject + body columns. Na template, na AI; wahi rules check hote hain.",
              "This lead's mail is its own text: the subject + body columns of the import file. No template, no AI; the same rules are checked.")
            : t("Is lead ke liye AI ki likhi mail.", "The mail the AI wrote for this lead.")} ${t(
          `Har lead ko sirf ek hi mail jaati hai. 'Text chahiye' = aapka text baaki hai ([OBSERVATION] jaisi khaali jagah ya toota hua rule), edit karke save karne tak approve nahi ho sakti; 'Approval baaki' = Approve page pe aapke click ka intezaar (app khud kabhi approve nahi karta); 'Approve ho gayi' = send queue mein, sending window, gap aur daily limit ke andar apne aap jayegi. ${SIDES.hi}`,
          `Each lead gets only one mail. 'Needs your text' = your text is missing (a part like [OBSERVATION] or a broken rule), it cannot be approved until you edit and save it; 'Awaiting approval' = waiting for your click on the Approve page (the app never approves by itself); 'Approved' = in the send queue, goes out by itself within the sending window, gap and daily limit. ${SIDES.en}`)}`}>
        {waiting && m && (
          <div className="mb-4">
            <Callout tone="warn" title={t("Text chahiye: ye mail aapke text ka wait kar rahi hai", "Needs your text: this mail is waiting for your text")}
              action={<Link href={textHref(m)} className="btn w-full sm:w-auto"><Icon name="pencil" size={14} />{t("Text likho", "Write the text")}</Link>}>
              <div className="space-y-2">
                {missesPart(m) && (
                  <p>{t(`Template ko {{observation}} chahiye, par is lead ki observation nahi di gayi. App wahan andaze se kuch nahi bharta: mail mein ${marksOf(m)} likha hai. Us jagah unki website ki ek asli problem likho jo aapne khud dekhi.`,
                    `The template needs {{observation}}, but no observation was given for this lead. The app guesses nothing there: the mail shows ${marksOf(m)}. Write one real problem on their website there that you saw yourself.`)}</p>
                )}
                {problems.length > 0 && (
                  <div>
                    <p>
                      {aiFailed
                        ? t("AI 5 koshish mein bhi is lead ki sahi mail nahi likh paya. Aakhri wajah:", "The AI could not write a valid mail for this lead in 5 tries. Last reason:")
                        : custom
                          ? t("Lead ka apna text (CSV) draft ke in rules pe fail hua:", "The lead's own text (CSV) broke these draft rules:")
                          : t("Template se bhara hua text draft ke in rules pe fail hua:", "The text filled from the template broke these draft rules:")}
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {problems.map((p) => <li key={p} className="break-words">{ruleText(p, t)}</li>)}
                    </ul>
                  </div>
                )}
                <p>
                  {aiFailed
                    ? t("Approve page pe 'Text edit karo' dabao, mail khud likho ya theek karo, aur save karo.", "On the Approve page press 'Edit text', write or fix the mail yourself, and save.")
                    : t("Approve page pe 'Text edit karo' dabao, text theek karo aur save karo.", "On the Approve page press 'Edit text', fix the text and save.")}{" "}
                  {t("Save ke baad mail 'Approval baaki' hogi (approve nahi); approve aap khud karoge.", "After saving, the mail is 'Awaiting approval' (not approved); you approve it yourself.")}
                </p>
              </div>
            </Callout>
          </div>
        )}
        {custom && (
          <p className="mb-4 flex items-start gap-1.5 text-xs text-slate-500">
            <Icon name="file" size={12} className="mt-0.5 shrink-0 text-slate-400" />
            <span className="min-w-0 break-words">
              {t("Lead ka apna text (CSV): ye mail import file ke subject + body columns se banti hai, na template se, na AI se.", "The lead's own text (CSV): this mail is made from the import file's subject + body columns, not from a template or by the AI.")}
            </span>
          </p>
        )}
        {tpl && (bySite || tplOff) && (
          <div className="mb-4 space-y-1 text-xs">
            <p className="flex items-start gap-1.5 text-slate-500">
              <Icon name="globe" size={12} className="mt-0.5 shrink-0 text-slate-400" />
              <span className="min-w-0 break-words">
                {siteText(own, t)}
                {bySite && (turnIds
                  ? t(
                    <>. Isliye ise &quot;{siteGroup(own.has, t)}&quot; group ke templates baari-baari se milte hain: <span className="font-medium text-slate-700">{tplNames}</span>. Kaunsa milega, ye draft bante waqt tay hota hai.</>,
                    <>. So it gets the templates of the &quot;{siteGroup(own.has, t)}&quot; group, in turn: <span className="font-medium text-slate-700">{tplNames}</span>. Which one is decided when its draft is made.</>,
                  )
                  : t(
                    <>. Isliye ise &quot;{siteGroup(own.has, t)}&quot; group ka template mila: <span className="font-medium text-slate-700">{tplName}</span></>,
                    <>. So it gets a template of the &quot;{siteGroup(own.has, t)}&quot; group: <span className="font-medium text-slate-700">{tplName}</span></>,
                  ))}
              </span>
            </p>
            {tplOff && (
              <p className="flex items-start gap-1.5 text-amber-700">
                <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
                <span className="min-w-0 break-words">
                  {t(`Par ${tplNo(tpl.id)} "${forText(tpl.for, t)}" ke liye likha hai. Jaane se pehle mail ek baar dhyan se padh lo.`,
                    `But ${tplNo(tpl.id)} is written for "${forText(tpl.for, t)}". Read the mail carefully before it goes out.`)}
                </span>
              </p>
            )}
          </div>
        )}
        {m && en ? (
          // left: the mail exactly as the lead gets it (the text saved at sending, or body + signature + footer as it will go);
          // right: the same mail in English, only for me
          <div className="grid gap-4 md:grid-cols-2">
            <MailPreview label={`${mailLabel(m, t)} · ${langName}`} subject={m.subject}
              text={m.sentText || fullText(s, m.body, m.language, ls?.sourceNote || NO_SOURCE)}
              footer={m.error && !wentOut
                ? <div className="break-words border-t border-red-100 bg-red-50/60 px-3 py-2 text-xs text-red-700"><span className="font-semibold">{t("Wajah:", "Reason:")}</span> {errText(m.error, t)}</div>
                : m.smtpResponse ? <div className="break-words border-t border-slate-100 bg-slate-50/70 px-3 py-2 text-xs text-slate-500"><span className="font-medium">{serverReply}</span> <span className="font-mono">{m.smtpResponse}</span></div> : undefined} />
            {waiting && en.kind !== "same" ? (
              // a draft still waiting for my words gets its English version once I have written and saved them
              <div className="min-w-0">
                <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400"><Icon name="globe" size={12} />English translation</div>
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs leading-relaxed text-slate-500">
                  {t("English translation tab banega jab aap apna text likh ke save karoge.", "The English translation is made once you write and save your text.")}
                </div>
              </div>
            ) : (
              <EnglishMail en={en} text={en.kind === "ready" ? fullText(s, en.body, "en", ls?.sourceNote || NO_SOURCE) : undefined}
                // no translate button while the mail waits for my text (translateMessage refuses it) or can no longer go out
                action={!waiting && (m.status === "ready" || (en.kind === "pending" && !["rejected", "blocked"].includes(m.status))) ? translateMessage.bind(null, m.id) : undefined} />
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-500">
              {custom
                ? t("Is contact ke liye abhi mail nahi bani. Campaign start hone ke baad worker iski mail lead ke apne text (CSV) se banayega, aur wo Approve page pe aayegi.",
                  "No mail has been made for this contact yet. After the campaign starts, the worker makes its mail from the lead's own text (CSV), and it appears on the Approve page.")
                : tpl
                  ? t(`Is contact ke liye abhi mail nahi bani. Campaign start hone ke baad worker iski mail ${turnIds ? `${tplNames} mein se ek` : tplName} se banayega, aur wo Approve page pe aayegi.`,
                    `No mail has been made for this contact yet. After the campaign starts, the worker makes its mail from ${turnIds ? `one of ${tplNames}` : tplName}, and it appears on the Approve page.`)
                  : t("Is contact ke liye abhi mail nahi bani. Campaign start hone ke baad AI iski mail likhega, aur wo Approve page pe aayegi.",
                    "No mail has been written for this contact yet. After the campaign starts, the AI writes its mail, and it appears on the Approve page.")}
            </p>
            {obsIds.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
                <span className="min-w-0 break-words">
                  {obsIds.length === forLead?.ids.length
                    ? t("Template mein {{observation}} hai aur is lead ki observation nahi hai: iski draft 'Text chahiye' banegi, aur wo hissa aap khud likhoge.",
                      "The template uses {{observation}} and this lead has none: its draft will wait as 'Needs your text', and you write that part yourself.")
                    : t(`${obsIds.map(tplNo).join(", ")} mein {{observation}} hai aur is lead ki observation nahi hai: wo template mila to draft 'Text chahiye' banegi.`,
                      `${obsIds.map(tplNo).join(", ")} ${obsIds.length === 1 ? "uses" : "use"} {{observation}} and this lead has none: if it gets ${obsIds.length === 1 ? "that template" : "one of them"}, its draft waits as 'Needs your text'.`)}
                </span>
              </p>
            )}
          </>
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

      <NextStep {...nextFor(l, m, cd, campHref, t)} />
    </div>
  );
}
