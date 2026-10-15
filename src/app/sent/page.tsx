import Link from "next/link";
import { C, rows, type SendLog } from "@/lib/fsdb";
import { DISPLAY_TZ, dayStart, fmt, fmtDate, partsIn, zoned } from "@/lib/time";
import { Icon } from "@/components/icons";
import { Info } from "@/components/Info";
import { ToastOnMount } from "@/components/toast";
import { Badge, Callout, EmptyState, KV, MailPreview, NextStep, PageHeader, Stat } from "@/components/ui";

export const metadata = { title: "Bheji gayi mails" };

type Row = SendLog & { subject?: string; text?: string; withLogo?: boolean; business?: string; leadEmail?: string };

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

const INFO = `Din ke hisaab se dekho kaunsi mail kab, kisko aur kis text ke saath gayi.
‹ › se din badlo, aur Live / Dry-run / Sab se list filter karo.
Kisi bhi mail pe click karo: poora text aur mail server ka jawab khul jayega.`;

export default async function Sent({ searchParams }: { searchParams: Promise<{ day?: string; mode?: string }> }) {
  const { day, mode = "live" } = await searchParams;
  const today = dayKey(new Date());
  const key = /^\d{4}-\d{2}-\d{2}$/.test(day || "") ? day! : today;
  const from = startOf(key);
  const to = dayStart(new Date(from.getTime() + 36 * 3600000), DISPLAY_TZ);
  const prev = dayKey(new Date(from.getTime() - 12 * 3600000));
  const next = dayKey(new Date(to.getTime() + 12 * 3600000));
  const yesterday = dayKey(new Date(startOf(today).getTime() - 12 * 3600000));
  const rel = key === today ? "Aaj" : key === yesterday ? "Kal" : null;

  const all = rows<Row>(await C.sendLogs.where("at", ">=", from.toISOString()).where("at", "<", to.toISOString()).orderBy("at", "desc").get());
  const live = all.filter((l) => !l.dryRun);
  const dry = all.filter((l) => l.dryRun);
  const shown = mode === "dry" ? dry : mode === "all" ? all : live;
  const failed = all.filter((l) => !l.ok).length;
  const active = mode === "dry" || mode === "all" ? mode : "live"; // unknown ?mode= shows the live list
  const tab = (m: string, label: string, n: number) => (
    <Link href={`/sent?day=${key}&mode=${m}`} className={`seg-item ${active === m ? "seg-item-on" : ""}`}>
      {label}
      <span className={`min-w-[18px] rounded-full px-1 text-center text-2xs font-semibold tabular-nums ${active === m ? "bg-indigo-50 text-indigo-700" : "bg-slate-300/50 text-slate-500"}`}>{n}</span>
    </Link>
  );

  const dayNav = (
    <nav aria-label="Din badlo" className="card flex w-full items-center gap-1 !p-1 sm:w-auto">
      <Link href={`/sent?day=${prev}&mode=${mode}`} className="btn-ghost btn-icon" aria-label="Pichhla din" title="Pichhla din"><Icon name="chevron-left" size={16} /></Link>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-1.5 sm:min-w-[180px]">
        <Icon name="calendar" size={15} className="text-indigo-500 max-[379px]:hidden" />
        <span className="truncate text-sm font-semibold text-slate-900">{fmtDate(from)}</span>
        {rel && <span className="rounded-full bg-indigo-50 px-1.5 text-2xs font-semibold leading-4 text-indigo-700">{rel}</span>}
      </div>
      {key !== today && <Link href={`/sent?day=${today}&mode=${mode}`} className="btn btn-sm">Aaj pe jao</Link>}
      {key < today
        ? <Link href={`/sent?day=${next}&mode=${mode}`} className="btn-ghost btn-icon" aria-label="Agla din" title="Agla din"><Icon name="chevron-right" size={16} /></Link>
        : <span className="btn-ghost btn-icon pointer-events-none text-slate-300" aria-hidden="true"><Icon name="chevron-right" size={16} /></span>}
    </nav>
  );

  const emptyTitle = active === "dry" ? "Is din koi dry-run mail nahi gayi" : active === "live" && all.length ? "Is din leads ko koi mail nahi gayi" : "Is din koi mail nahi gayi";
  // Live tab empty but test mails exist: the NextStep opens the Dry-run tab (the one primary action)
  const onlyDry = !shown.length && dry.length > 0 && active !== "dry";
  // a failed live send may be a refusal (4xx: retried next sending day) or an unknown result (timeout: lead goes to Manual check)
  const liveFailed = live.filter((l) => !l.ok).length;
  const failTitle = `${failed} ${failed === 1 ? "mail" : "mails"} ${liveFailed ? "fail hui ya result pakka nahi" : "fail hui"}`;
  // phones show short labels right above the tabs: they count only delivered mails, so they must not reuse the tab names
  const stats = [
    { label: "Leads ko gayi (live)", short: "Gayi", value: live.filter((l) => l.ok).length, icon: "send", tone: "emerald", dot: "bg-emerald-500",
      info: "Is din kitni mails asli leads ko gayi aur mail server ne accept ki." },
    { label: "Dry-run (aapke test address pe)", short: "Test", value: dry.filter((l) => l.ok).length, icon: "flask", tone: "amber", dot: "bg-amber-500",
      info: "DRY-RUN mode mein mail lead ko nahi jaati, sirf aapke test address pe aati hai. Isse check karo ki mail kaisi dikhti hai." },
    { label: "Fail / result pakka nahi", short: "Fail", value: failed, icon: "x-circle", tone: "red", dot: "bg-red-500",
      info: "Jo mails server ne mana ki, ya jinka result pakka nahi (jaise timeout). Mail kholo aur 'Server ka jawab' padho. 4xx wali mail agle sending din apne aap dobara try hoti hai. Result pakka nahi wali lead Contacts › Manual check mein jaati hai: use khud dobara mail mat bhejo." },
  ] as const;

  return (
    <div className="space-y-4">
      <PageHeader title="Bheji gayi mails" info={INFO} sub={`Samay IST (${DISPLAY_TZ}) mein`} actions={dayNav} />

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
              ? <Link href={`/sent?day=${key}&mode=all`} className="btn btn-sm">Sab dekho</Link>
              : <Link href="/logs" className="btn btn-sm">Logs dekho</Link>}
            {liveFailed > 0 && <Link href="/contacts?status=check_manual" className="btn btn-sm">Manual check wale dekho</Link>}
          </>}>
          {liveFailed > 0
            ? <>Mail kholo aur &quot;Server ka jawab&quot; padho. 4xx wali mail agle sending din apne aap dobara try hogi. Timeout wali (result pakka nahi) shayad pahunch gayi ho: use Contacts › Manual check mein mark karo, khud dobara mail mat bhejo.</>
            : <>Mail kholo aur &quot;Server ka jawab&quot; padho: wahan wajah likhi hoti hai.</>}
        </Callout>
      )}
      {failed > 0 && key === today && (
        <ToastOnMount kind="warning" title={`Aaj ${failTitle}`}
          text={liveFailed
            ? "Mail kholo aur 'Server ka jawab' padho. Result pakka nahi (timeout) wali mail khud dobara mat bhejo: Contacts › Manual check mein mark karo."
            : "Test mail fail hui. Mail kholo aur 'Server ka jawab' mein wajah padho."}
          once={`sent-failed:${key}:${failed}`} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="seg">{tab("live", "Live", live.length)}{tab("dry", "Dry-run", dry.length)}{tab("all", "Sab", all.length)}</div>
          <Info title="Live / Dry-run / Sab" text="Live = asli leads ko gayi mails. Dry-run = sirf aapke test address pe gayi test mails. Sab = dono, fail hui mails samet." />
        </div>
        {shown.length > 0 && (
          <span className="text-xs text-slate-500">{shown.length} {shown.length === 1 ? "mail" : "mails"}<span className="hidden sm:inline"> · nayi sabse upar</span></span>
        )}
      </div>

      {shown.length > 0 ? (
        <div className="space-y-2">
          {shown.map((l) => (
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
                    <div className="mt-0.5 truncate text-sm text-slate-700 sm:mt-0 sm:min-w-[12rem] sm:flex-1">{l.subject || "(subject save nahi hua)"}</div>
                  </div>
                  <Icon name="chevron-down" size={16} className="mt-px text-slate-400 transition-transform group-open:rotate-180 sm:mt-0" />
                </div>
              </summary>
              <div className="grid gap-4 border-t border-slate-100 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-6">
                <MailPreview label="Mail jo gayi" subject={l.subject || "(subject save nahi hua)"} text={l.text || "(text save nahi hua)"}
                  footer={l.withLogo ? (
                    <div className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                      <Icon name="check" size={12} className="text-emerald-600" />Logo ke saath gayi (signature mein)
                    </div>
                  ) : undefined} />
                <div className="min-w-0 space-y-3">
                  <KV label={l.dryRun ? "Kisko gayi (test address)" : "Kisko gayi"}>{l.to}</KV>
                  {l.dryRun && l.leadEmail && <KV label="Lead">{l.leadEmail}</KV>}
                  <KV label="Samay">{fmt(l.at)}</KV>
                  <div>
                    <div className="flex items-center gap-1 text-xs font-medium text-slate-400">
                      Server ka jawab
                      <Info title="Server ka jawab" size={12} text="Mail server (SMTP) ne mail lete waqt jo jawab diya. '250' se shuru ho to mail accept ho gayi. Fail hone pe yahan wajah dikhti hai." />
                    </div>
                    <div className="mt-1 break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs leading-relaxed text-slate-600">{l.response || "—"}</div>
                  </div>
                  {l.leadId && (
                    <Link href={`/contacts/${encodeURIComponent(l.leadId)}`} className="link inline-flex items-center gap-1 text-sm">
                      Contact ki history<Icon name="arrow-right" size={13} />
                    </Link>
                  )}
                </div>
              </div>
            </details>
          ))}
        </div>
      ) : (
        <div className="card">
          {/* the NextStep below is the one primary action; this card adds at most a secondary link */}
          <EmptyState icon="send" title={emptyTitle}
            text={all.length ? `Is din ${all.length} ${all.length === 1 ? "mail doosre tab mein hai" : "mails doosre tabs mein hain"}.` : "Pichhle din dekhne ke liye upar ‹ dabao. Mails sirf sending window mein jaati hain."}>
            {all.length > 0 && !onlyDry && <Link href={`/sent?day=${key}&mode=all`} className="btn mt-4">Sab mails dekho<Icon name="arrow-right" size={14} /></Link>}
          </EmptyState>
        </div>
      )}

      {shown.length > 0 && active === "dry" ? (
        <NextStep text="Test mails apne inbox mein khol ke dekho ki wo kaisi dikhti hain. Live / Dry-run mode Dashboard se badalta hai." href="/#mode" cta="Mode dekho" />
      ) : shown.length > 0 ? (
        <NextStep text="Lead ka jawab aaya to wo Replies (Inbox) mein dikhega. Inbox har 10 minute mein apne aap sync hota hai." href="/replies" cta="Replies dekho" />
      ) : onlyDry ? (
        <NextStep text={`${key === today ? "Aaj" : "Is din"} sirf test (dry-run) ${dry.length === 1 ? "mail hai, wo Dry-run tab mein dikhti hai" : "mails hain, wo Dry-run tab mein dikhti hain"}. Unhe dekh lo; asli leads ko mail tabhi jaati hai jab Dashboard pe LIVE mode on ho.`}
          href={`/sent?day=${key}&mode=dry`} cta="Dry-run mails dekho" />
      ) : (
        <NextStep text="Approve page pe ruki mails approve karo. Approve ki hui mails sending window mein jayengi aur yahan dikhengi." href="/review" cta="Approve page kholo" />
      )}

      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        <Icon name="mail-check" size={14} className="mt-px text-slate-400" />
        Har live mail ki copy aapke mailbox ke Sent folder mein bhi hai (Hostinger webmail).
      </p>
    </div>
  );
}
