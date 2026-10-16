import Link from "next/link";
import { fullText, signature } from "@/lib/compose";
import { englishOf, textKey, type EnglishState } from "@/lib/english";
import { C, rows, type Message, type SendLog } from "@/lib/fsdb";
import { getT } from "@/lib/i18n-server";
import { LANGS } from "@/lib/lang";
import { getAllChunked } from "@/lib/ledger";
import { getSettings } from "@/lib/settings";
import { DISPLAY_TZ, dayStart, fmt, fmtDate, partsIn, zoned } from "@/lib/time";
import { EnglishMail } from "@/components/EnglishMail";
import { translateMessage } from "../actions";
import { Icon } from "@/components/icons";
import { Info } from "@/components/Info";
import { ToastOnMount } from "@/components/toast";
import { Badge, Callout, EmptyState, KV, MailPreview, NextStep, PageHeader, Stat } from "@/components/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Bheji gayi mails", "Sent mails") };
}

type Row = SendLog & { subject?: string; text?: string; textKey?: string; withLogo?: boolean; business?: string; leadEmail?: string; campaignId?: string };
/** The message a sent row went out from: its language, and its English (null = the text changed after this send). */
type Side = { id: string; lang: string; en: EnglishState | null; campaignId: string };

const dayKey = (d: Date) => partsIn(d, DISPLAY_TZ).dayKey;
function startOf(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return zoned(y, m, d, 0, 0, DISPLAY_TZ);
}
/** HH:MM in IST (the day is already shown on top). */
function clock(iso: string) {
  const p = partsIn(new Date(iso), DISPLAY_TZ);
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
}

export default async function Sent({ searchParams }: { searchParams: Promise<{ day?: string; mode?: string }> }) {
  const { t } = await getT();
  const { day, mode = "live" } = await searchParams;
  const today = dayKey(new Date());
  const key = /^\d{4}-\d{2}-\d{2}$/.test(day || "") ? day! : today;
  const from = startOf(key);
  const to = dayStart(new Date(from.getTime() + 36 * 3600000), DISPLAY_TZ);
  const prev = dayKey(new Date(from.getTime() - 12 * 3600000));
  const next = dayKey(new Date(to.getTime() + 12 * 3600000));
  const yesterday = dayKey(new Date(startOf(today).getTime() - 12 * 3600000));
  const rel = key === today ? t("Aaj", "Today") : key === yesterday ? t("Kal", "Yesterday") : null;

  const all = rows<Row>(await C.sendLogs.where("at", ">=", from.toISOString()).where("at", "<", to.toISOString()).orderBy("at", "desc").get());
  const live = all.filter((l) => !l.dryRun);
  const dry = all.filter((l) => l.dryRun);
  const shown = mode === "dry" ? dry : mode === "all" ? all : live;
  const failed = all.filter((l) => !l.ok).length;
  const active = mode === "dry" || mode === "all" ? mode : "live"; // unknown ?mode= shows the live list

  // The English next to each sent mail: the message it went out from (message doc id = lead id), read once for the
  // rows shown. Its translation counts only for the text that went out: a mail sent in dry-run can still be edited or
  // remade before the live send, and then its English no longer matches this row.
  const msgIds = [...new Set(shown.map((l) => l.messageId || l.leadId).filter((x): x is string => !!x))];
  const msgs = new Map<string, Message>();
  for (const d of await getAllChunked(msgIds.map((id) => C.messages.doc(id)))) if (d.exists) msgs.set(d.id, { id: d.id, ...d.data() } as Message);
  // older rows (no fingerprint) are compared up to the signature, so a mail whose last paragraphs were deleted later
  // does not pass as the same; when in doubt the English is not shown
  const s = msgs.size ? await getSettings() : null;
  const sides = new Map<string, Side>();
  for (const l of shown) {
    const m = msgs.get(l.messageId || l.leadId || "");
    if (!m) continue;
    // the text that went out = body + signature + footer (lib/compose.ts)
    // rows logged since the fingerprint exist compare it exactly; older rows fall back to comparing the text
    const same = l.textKey
      ? l.textKey === textKey(m.subject, m.body)
      : (!l.subject || l.subject === m.subject) && !!l.text && !!s && l.text.startsWith(`${m.body.trim()}\n\n${signature(s)}`);
    sides.set(l.id, { id: m.id, lang: m.language, en: same || m.language === "en" ? englishOf(m) : null, campaignId: l.campaignId || m.campaignId || "" });
  }
  // The English mirrors the full sent text: English body + signature + English footer, whose source line comes from
  // the campaign's list as in lib/sender.ts (read only where an English text is shown, once per campaign / list)
  const campIds = [...new Set([...sides.values()].filter((x) => x.en?.kind === "ready").map((x) => x.campaignId))];
  const campSnaps = await getAllChunked(campIds.filter(Boolean).map((id) => C.campaigns.doc(id)));
  const listOf = new Map(campSnaps.filter((d) => d.exists).map((d) => [d.id, String(d.get("listId") || "")]));
  const listSnaps = await getAllChunked([...new Set([...listOf.values()].filter(Boolean))].map((id) => C.lists.doc(id)));
  const noteOf = new Map(listSnaps.filter((d) => d.exists).map((d) => [d.id, String(d.get("sourceNote") || "")]));
  const sourceOf = (campaignId: string) => noteOf.get(listOf.get(campaignId) || "") || "a public business directory";
  const langName = (lang?: string) => LANGS[lang || ""] || (lang || "—").toUpperCase();
  const tab = (m: string, label: string, n: number) => (
    <Link href={`/sent?day=${key}&mode=${m}`} className={`seg-item ${active === m ? "seg-item-on" : ""}`}>
      {label}
      <span className={`min-w-[18px] rounded-full px-1 text-center text-2xs font-semibold tabular-nums ${active === m ? "bg-indigo-50 text-indigo-700" : "bg-slate-300/50 text-slate-500"}`}>{n}</span>
    </Link>
  );

  const prevDay = t("Pichhla din", "Previous day");
  const nextDay = t("Agla din", "Next day");
  const dayNav = (
    <nav aria-label={t("Din badlo", "Change day")} className="card flex w-full items-center gap-1 !p-1 sm:w-auto">
      <Link href={`/sent?day=${prev}&mode=${mode}`} className="btn-ghost btn-icon" aria-label={prevDay} title={prevDay}><Icon name="chevron-left" size={16} /></Link>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-1.5 sm:min-w-[180px]">
        <Icon name="calendar" size={15} className="text-indigo-500 max-[379px]:hidden" />
        <span className="truncate text-sm font-semibold text-slate-900">{fmtDate(from)}</span>
        {rel && <span className="rounded-full bg-indigo-50 px-1.5 text-2xs font-semibold leading-4 text-indigo-700">{rel}</span>}
      </div>
      {key !== today && <Link href={`/sent?day=${today}&mode=${mode}`} className="btn btn-sm">{t("Aaj pe jao", "Today")}</Link>}
      {key < today
        ? <Link href={`/sent?day=${next}&mode=${mode}`} className="btn-ghost btn-icon" aria-label={nextDay} title={nextDay}><Icon name="chevron-right" size={16} /></Link>
        : <span className="btn-ghost btn-icon pointer-events-none text-slate-300" aria-hidden="true"><Icon name="chevron-right" size={16} /></span>}
    </nav>
  );

  const emptyTitle = active === "dry"
    ? t("Is din koi dry-run mail nahi gayi", "No dry-run mails on this day")
    : active === "live" && all.length
      ? t("Is din leads ko koi mail nahi gayi", "No mails went to leads on this day")
      : t("Is din koi mail nahi gayi", "No mails went out on this day");
  // Live tab empty but test mails exist: the NextStep opens the Dry-run tab (the one primary action)
  const onlyDry = !shown.length && dry.length > 0 && active !== "dry";
  // a failed live send may be a refusal (4xx: retried next sending day) or an unknown result (timeout: lead goes to Manual check)
  const liveFailed = live.filter((l) => !l.ok).length;
  const failTitle = t(
    `${failed} ${failed === 1 ? "mail" : "mails"} ${liveFailed ? "fail hui ya result pakka nahi" : "fail hui"}`,
    liveFailed
      ? `${failed} ${failed === 1 ? "mail failed or has" : "mails failed or have"} an uncertain result`
      : `${failed} ${failed === 1 ? "mail" : "mails"} failed`,
  );
  // phones show short labels right above the tabs: they count only delivered mails, so they must not reuse the tab names
  const stats = [
    { label: t("Leads ko gayi (live)", "Sent to leads (live)"), short: t("Gayi", "Sent"), value: live.filter((l) => l.ok).length, icon: "send", tone: "emerald", dot: "bg-emerald-500",
      info: t("Is din kitni mails asli leads ko gayi aur mail server ne accept ki.", "How many mails went to real leads on this day and were accepted by the mail server.") },
    { label: t("Dry-run (aapke test address pe)", "Dry-run (to your test address)"), short: "Test", value: dry.filter((l) => l.ok).length, icon: "flask", tone: "amber", dot: "bg-amber-500",
      info: t(
        "DRY-RUN mode mein mail lead ko nahi jaati, sirf aapke test address pe aati hai. Isse check karo ki mail kaisi dikhti hai.",
        "In DRY-RUN mode a mail does not go to the lead, only to your test address. Use it to check how the mail looks.",
      ) },
    { label: t("Fail / result pakka nahi", "Failed / uncertain"), short: t("Fail", "Failed"), value: failed, icon: "x-circle", tone: "red", dot: "bg-red-500",
      info: t(
        "Jo mails server ne mana ki, ya jinka result pakka nahi (jaise timeout). Mail kholo aur 'Server ka jawab' padho. 4xx wali mail agle sending din apne aap dobara try hoti hai. Result pakka nahi wali lead Contacts › Manual check mein jaati hai: use khud dobara mail mat bhejo.",
        "Mails the server refused, or whose result is uncertain (such as a timeout). Open the mail and read 'Server reply'. A mail refused with a 4xx code is retried automatically on the next sending day. A lead with an uncertain result goes to Contacts › Manual check: do not mail it again yourself.",
      ) },
  ] as const;
  const info = t(
    `Din ke hisaab se dekho kaunsi mail kab, kisko aur kis text ke saath gayi.
‹ › se din badlo, aur Live / Dry-run / Sab se list filter karo.
Kisi bhi mail pe click karo: poora text aur mail server ka jawab khul jayega.
Left mein mail bilkul waise hai jaise gayi (lead ki bhasha mein); right mein usi mail ka English matlab, sirf aapke check ke liye.`,
    `See day by day which mail went out when, to whom and with what text.
Change the day with ‹ ›, and filter the list with Live / Dry-run / All.
Click any mail to open its full text and the mail server's reply.
The left shows the mail exactly as it went out (in the lead's language); the right shows the same mail's meaning in English, only for you to check.`,
  );
  const noSubject = t("(subject save nahi hua)", "(subject not recorded)");
  const serverReply = t("Server ka jawab", "Server reply");

  /** Recipient, time, server reply and contact link: a side column next to a lone mail, a strip under a mail + English. */
  const meta = (l: Row, under: boolean) => {
    const kv = (
      <>
        <KV label={l.dryRun ? t("Kisko gayi (test address)", "Sent to (test address)") : t("Kisko gayi", "Sent to")}>{l.to}</KV>
        {l.dryRun && l.leadEmail && <KV label="Lead">{l.leadEmail}</KV>}
        <KV label={t("Samay", "Time")}>{fmt(l.at)}</KV>
      </>
    );
    const reply = (
      <div>
        <div className="flex items-center gap-1 text-xs font-medium text-slate-400">
          {serverReply}
          <Info title={serverReply} size={12}
            text={t(
              "Mail server (SMTP) ne mail lete waqt jo jawab diya. '250' se shuru ho to mail accept ho gayi. Fail hone pe yahan wajah dikhti hai.",
              "What the mail server (SMTP) answered when it took the mail. If it starts with '250', the mail was accepted. If it failed, the reason shows here.",
            )} />
        </div>
        <div className="mt-1 break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs leading-relaxed text-slate-600">{l.response || "—"}</div>
      </div>
    );
    const history = l.leadId && (
      <Link href={`/contacts/${encodeURIComponent(l.leadId)}`} className="link inline-flex items-center gap-1 text-sm">
        {t("Contact ki history", "Contact history")}<Icon name="arrow-right" size={13} />
      </Link>
    );
    return under ? (
      <div className="space-y-3 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">{kv}{history && <div className="sm:ml-auto">{history}</div>}</div>
        {reply}
      </div>
    ) : (
      <div className="min-w-0 space-y-3">{kv}{reply}{history}</div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t("Bheji gayi mails", "Sent mails")} info={info} sub={t(`Samay IST (${DISPLAY_TZ}) mein`, `Times in IST (${DISPLAY_TZ})`)} actions={dayNav} />

      {/* phones: one compact strip like an app; bigger screens: three tiles */}
      <div className="card grid grid-cols-3 divide-x divide-slate-100 !p-0 sm:hidden">
        {stats.map((x) => (
          <div key={x.short} className="min-w-0 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${x.dot}`} />
              <span className="truncate">{x.short}</span>
              <Info title={x.label} text={x.info} size={12} />
            </div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{x.value}</div>
          </div>
        ))}
      </div>
      <div className="hidden gap-3 sm:grid sm:grid-cols-3">
        {stats.map((x) => <Stat key={x.short} label={x.label} value={x.value} icon={x.icon} tone={x.tone} info={x.info} />)}
      </div>

      {failed > 0 && (
        <Callout tone="danger" title={failTitle}
          action={<>
            {active !== "all"
              ? <Link href={`/sent?day=${key}&mode=all`} className="btn btn-sm">{t("Sab dekho", "See all")}</Link>
              : <Link href="/logs" className="btn btn-sm">{t("Logs dekho", "See logs")}</Link>}
            {liveFailed > 0 && <Link href="/contacts?status=check_manual" className="btn btn-sm">{t("Manual check wale dekho", "See Manual check leads")}</Link>}
          </>}>
          {liveFailed > 0
            ? t(
              <>Mail kholo aur &quot;Server ka jawab&quot; padho. 4xx wali mail agle sending din apne aap dobara try hogi. Timeout wali (result pakka nahi) shayad pahunch gayi ho: use Contacts › Manual check mein mark karo, khud dobara mail mat bhejo.</>,
              <>Open the mail and read &quot;Server reply&quot;. A mail refused with a 4xx code is retried automatically on the next sending day. One that timed out (uncertain result) may have arrived: mark it in Contacts › Manual check, and do not mail it again yourself.</>,
            )
            : t(
              <>Mail kholo aur &quot;Server ka jawab&quot; padho: wahan wajah likhi hoti hai.</>,
              <>Open the mail and read &quot;Server reply&quot;: the reason is written there.</>,
            )}
        </Callout>
      )}
      {failed > 0 && key === today && (
        <ToastOnMount kind="warning" title={t(`Aaj ${failTitle}`, `Today: ${failTitle}`)}
          text={liveFailed
            ? t(
              "Mail kholo aur 'Server ka jawab' padho. Result pakka nahi (timeout) wali mail khud dobara mat bhejo: Contacts › Manual check mein mark karo.",
              "Open the mail and read 'Server reply'. Do not resend a mail with an uncertain result (timeout) yourself: mark it in Contacts › Manual check.",
            )
            : t("Test mail fail hui. Mail kholo aur 'Server ka jawab' mein wajah padho.", "A test mail failed. Open the mail and read the reason in 'Server reply'.")}
          once={`sent-failed:${key}:${failed}`} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="seg">{tab("live", "Live", live.length)}{tab("dry", "Dry-run", dry.length)}{tab("all", t("Sab", "All"), all.length)}</div>
          <Info title={t("Live / Dry-run / Sab", "Live / Dry-run / All")}
            text={t(
              "Live = asli leads ko gayi mails. Dry-run = sirf aapke test address pe gayi test mails. Sab = dono, fail hui mails samet.",
              "Live = mails sent to real leads. Dry-run = test mails sent only to your test address. All = both, including failed mails.",
            )} />
        </div>
        {shown.length > 0 && (
          <span className="text-xs text-slate-500">{shown.length} {shown.length === 1 ? "mail" : "mails"}<span className="hidden sm:inline">{t(" · nayi sabse upar", " · newest first")}</span></span>
        )}
      </div>

      {shown.length > 0 ? (
        <div className="space-y-2">
          {shown.map((l) => {
            const sd = sides.get(l.id);
            const sent = (
              <MailPreview label={sd ? `${t("Mail jo gayi", "Mail as sent")} · ${langName(sd.lang)}` : t("Mail jo gayi", "Mail as sent")}
                subject={l.subject || noSubject} text={l.text || t("(text save nahi hua)", "(text not recorded)")}
                footer={l.withLogo ? (
                  <div className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                    <Icon name="check" size={12} className="text-emerald-600" />{t("Logo ke saath gayi (signature mein)", "Sent with the logo (in the signature)")}
                  </div>
                ) : undefined} />
            );
            return (
              <details key={l.id} className="card-flush group">
                <summary className="cursor-pointer select-none px-4 py-3 transition hover:bg-slate-50/70 sm:px-5">
                  <div className="flex items-start gap-3 sm:items-center">
                    <span className="w-10 shrink-0 pt-px text-xs font-semibold tabular-nums text-slate-500 sm:pt-0">{clock(l.at)}</span>
                    <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
                      {/* the subject is what people scan: it keeps 12rem, the name and address columns give way first (same widths on every row, so they stay aligned) */}
                      <div className="flex min-w-0 items-center gap-2 sm:w-56 xl:w-72">
                        <Badge v={l.ok ? (l.dryRun ? "dry-run" : "sent") : "failed"} />
                        <span className="truncate text-sm font-medium text-slate-900">{l.business || l.leadEmail || l.to}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500 sm:mt-0 sm:w-48 xl:w-60">{l.dryRun ? `${l.leadEmail || "Lead"} → test address` : l.to}</div>
                      <div className="mt-0.5 truncate text-sm text-slate-700 sm:mt-0 sm:min-w-[12rem] sm:flex-1">{l.subject || noSubject}</div>
                    </div>
                    <Icon name="chevron-down" size={16} className="mt-px text-slate-400 transition-transform group-open:rotate-180 sm:mt-0" />
                  </div>
                </summary>
                {sd ? (
                  // left: the mail exactly as it went out; right: the same mail in English (only for checking, never sent)
                  <div className="space-y-4 border-t border-slate-100 px-4 py-4 sm:px-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      {sent}
                      {sd.en ? (
                        <EnglishMail en={sd.en} text={sd.en.kind === "ready" && s ? fullText(s, sd.en.body, "en", sourceOf(sd.campaignId)) : undefined}
                          action={sd.en.kind === "pending" ? translateMessage.bind(null, sd.id) : undefined} />
                      ) : (
                        <div className="min-w-0">
                          <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400"><Icon name="globe" size={12} />English translation</div>
                          <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs leading-relaxed text-slate-500">
                            <Icon name="info" size={16} className="mx-auto mb-1.5 text-slate-400" />
                            {t("Ye mail jaane ke baad iska text badla (edit ya naya version), isliye iska English yahan nahi dikhaya. Nayi mail ka English contact page pe hai.",
                              "The text was changed after this mail went out (an edit or a new version), so its English is not shown here. The new mail's English is on the contact page.")}
                          </div>
                        </div>
                      )}
                    </div>
                    {meta(l, true)}
                  </div>
                ) : (
                  <div className="grid gap-4 border-t border-slate-100 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-6">
                    {sent}
                    {meta(l, false)}
                  </div>
                )}
              </details>
            );
          })}
        </div>
      ) : (
        <div className="card">
          {/* the NextStep below is the one primary action; this card adds at most a secondary link */}
          <EmptyState icon="send" title={emptyTitle}
            text={all.length
              ? t(
                `Is din ${all.length} ${all.length === 1 ? "mail doosre tab mein hai" : "mails doosre tabs mein hain"}.`,
                `On this day, ${all.length} ${all.length === 1 ? "mail is in another tab" : "mails are in other tabs"}.`,
              )
              : t("Pichhle din dekhne ke liye upar ‹ dabao. Mails sirf sending window mein jaati hain.", "Press ‹ above to see earlier days. Mails only go out in the sending window.")}>
            {all.length > 0 && !onlyDry && <Link href={`/sent?day=${key}&mode=all`} className="btn mt-4">{t("Sab mails dekho", "See all mails")}<Icon name="arrow-right" size={14} /></Link>}
          </EmptyState>
        </div>
      )}

      {shown.length > 0 && active === "dry" ? (
        <NextStep
          text={t(
            "Test mails apne inbox mein khol ke dekho ki wo kaisi dikhti hain. Live / Dry-run mode Dashboard se badalta hai.",
            "Open the test mails in your inbox to see how they look. You switch between Live and Dry-run mode on the Dashboard.",
          )}
          href="/#mode" cta={t("Mode dekho", "See mode")} />
      ) : shown.length > 0 ? (
        <NextStep
          text={t(
            "Lead ka jawab aaya to wo Replies (Inbox) mein dikhega. Inbox har 10 minute mein apne aap sync hota hai.",
            "When a lead replies, the reply shows up in Replies (Inbox). The inbox syncs automatically every 10 minutes.",
          )}
          href="/replies" cta={t("Replies dekho", "See replies")} />
      ) : onlyDry ? (
        <NextStep
          text={t(
            `${key === today ? "Aaj" : "Is din"} sirf test (dry-run) ${dry.length === 1 ? "mail hai, wo Dry-run tab mein dikhti hai" : "mails hain, wo Dry-run tab mein dikhti hain"}. Unhe dekh lo; asli leads ko mail tabhi jaati hai jab Dashboard pe LIVE mode on ho.`,
            `${key === today ? "Today" : "On this day"} there ${dry.length === 1 ? "is only a test (dry-run) mail; it shows in the Dry-run tab" : "are only test (dry-run) mails; they show in the Dry-run tab"}. Take a look; mail only goes to real leads when LIVE mode is on in the Dashboard.`,
          )}
          href={`/sent?day=${key}&mode=dry`} cta={t("Dry-run mails dekho", "See dry-run mails")} />
      ) : (
        <NextStep
          text={t(
            "Approve page pe ruki mails approve karo. Approve ki hui mails sending window mein jayengi aur yahan dikhengi.",
            "Approve the mails waiting on the Approve page. Approved mails go out in the sending window and show up here.",
          )}
          href="/review" cta={t("Approve page kholo", "Open Approve page")} />
      )}

      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        <Icon name="mail-check" size={14} className="mt-px text-slate-400" />
        {t("Har live mail ki copy aapke mailbox ke Sent folder mein bhi hai (Hostinger webmail).", "Every live mail also has a copy in your mailbox's Sent folder (Hostinger webmail).")}
      </p>
    </div>
  );
}
