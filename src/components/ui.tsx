import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { Info } from "./Info";

// Shared building blocks. Server components can use all of these (Info is a small client island).

export type Tone = "slate" | "sky" | "amber" | "emerald" | "violet" | "red" | "orange" | "indigo";

const BADGE_TONE: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-600 ring-slate-500/10",
  sky: "bg-sky-50 text-sky-700 ring-sky-600/15",
  amber: "bg-amber-50 text-amber-700 ring-amber-600/20",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/15",
  red: "bg-red-50 text-red-700 ring-red-600/15",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/15",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/15",
};

/** Hinglish label and colour for every status value the app stores. */
const STATUS: Record<string, [string, Tone]> = {
  ready: ["Ready", "sky"],
  needs_review: ["Review chahiye", "amber"],
  rejected: ["Reject kiya", "slate"],
  sent: ["Sent", "emerald"],
  replied: ["Reply aaya", "violet"],
  bounced: ["Bounce", "red"],
  opted_out: ["Opt-out", "orange"],
  check_manual: ["Manual check", "red"],
  failed: ["Fail", "red"],
  suppressed: ["Block list", "slate"],
  already_contacted: ["Pehle contact hua", "slate"],
  running: ["Chal raha hai", "emerald"],
  paused: ["Ruka hua", "amber"],
  draft: ["Draft", "slate"],
  done: ["Poora hua", "indigo"],
  send: ["Bhejenge", "emerald"],
  skip: ["Skip", "slate"],
  review: ["Review", "amber"],
  retry: ["Retry", "amber"],
  sending: ["Ja rahi hai", "sky"],
  blocked: ["Blocked", "red"],
  info: ["Info", "slate"],
  warn: ["Warning", "amber"],
  error: ["Error", "red"],
  "dry-run": ["Dry-run", "amber"],
  live: ["Live", "emerald"],
  reply: ["Reply", "violet"],
  optout: ["Opt-out", "orange"],
  bounce: ["Bounce", "red"],
  softbounce: ["Soft bounce", "amber"],
  auto: ["Auto-reply", "slate"],
  contacted_elsewhere: ["Aapne khud mail kiya", "slate"],
  not_sent_checked: ["Nahi gayi (check kiya)", "slate"],
  uncertain: ["Pakka nahi", "amber"],
  refused_will_retry: ["Retry hoga", "amber"],
};

export function Badge({ v, label, tone, dot = true }: { v: string; label?: string; tone?: Tone; dot?: boolean }) {
  const [l, t] = STATUS[v] || [v.replace(/_/g, " "), "slate" as Tone];
  return (
    <span className={`badge ${BADGE_TONE[tone || t]}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {label ?? l}
    </span>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm shadow-indigo-600/30" style={{ width: size, height: size }}>
      <Icon name="send" size={Math.round(size * 0.5)} strokeWidth={2.2} />
    </span>
  );
}

/** Page title row: title + (i), a one-line subtitle, and actions on the right (stacked on phones). */
export function PageHeader({ title, info, sub, actions, back }: { title: ReactNode; info?: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1.5 hidden items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 lg:inline-flex">
            <Icon name="chevron-left" size={14} />{back.label}
          </Link>
        )}
        <div className="flex items-start gap-2">
          <h1 className="h1 min-w-0 break-words">{title}</h1>
          {info && <span className="mt-[5px] flex"><Info text={info} title={typeof title === "string" ? title : undefined} size={15} /></span>}
        </div>
        {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A card with a header (icon, title, (i), sub, actions). Use flush for tables that touch the card edges. */
export function Section({ title, info, sub, icon, actions, children, className = "", flush = false, id }: {
  title?: ReactNode; info?: ReactNode; sub?: ReactNode; icon?: IconName; actions?: ReactNode; children?: ReactNode; className?: string; flush?: boolean; id?: string;
}) {
  return (
    <section id={id} className={`${flush ? "card-flush" : "card"} ${className}`}>
      {(title || actions) && (
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${flush ? "border-b border-slate-100 px-4 py-3 sm:px-5" : "mb-4"}`}>
          {icon && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><Icon name={icon} size={15} /></span>}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h2 className="h2">{title}</h2>
              {info && <Info text={info} title={typeof title === "string" ? title : undefined} />}
            </div>
            {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const STAT_TONE: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-500",
  sky: "bg-sky-50 text-sky-600",
  amber: "bg-amber-50 text-amber-600",
  emerald: "bg-emerald-50 text-emerald-600",
  violet: "bg-violet-50 text-violet-600",
  red: "bg-red-50 text-red-600",
  orange: "bg-orange-50 text-orange-600",
  indigo: "bg-indigo-50 text-indigo-600",
};

/** Number tile. With href the whole tile is a link, so do not put another link inside value or sub. */
export function Stat({ label, value, sub, info, icon, tone = "slate", href }: { label: string; value: ReactNode; sub?: ReactNode; info?: ReactNode; icon?: IconName; tone?: Tone; href?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        {icon && <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${STAT_TONE[tone]}`}><Icon name={icon} size={13} /></span>}
        <span className="line-clamp-2 min-w-0 leading-tight">{label}</span>
        {info && <Info text={info} title={label} size={13} />}
        {href && <Icon name="chevron-right" size={14} className="ml-auto hidden text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500 sm:block" />}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </>
  );
  return href
    ? <Link href={href} className="card group block transition hover:border-slate-300 hover:shadow-md">{body}</Link>
    : <div className="card">{body}</div>;
}

const NEXT_TONE = {
  indigo: { box: "border-indigo-200/70 from-indigo-50", dot: "bg-indigo-600", label: "text-indigo-600", icon: "arrow-right" as IconName },
  emerald: { box: "border-emerald-200/70 from-emerald-50", dot: "bg-emerald-600", label: "text-emerald-700", icon: "check" as IconName },
  amber: { box: "border-amber-200/80 from-amber-50", dot: "bg-amber-500", label: "text-amber-700", icon: "clock" as IconName },
};

/** "Aage kya karna hai?" guidance: tells the user where to go next and what to do there. */
export function NextStep({ text, href, cta, title = "Aage kya karna hai?", tone = "indigo", children }: { text: ReactNode; href?: string; cta?: string; title?: string; tone?: keyof typeof NEXT_TONE; children?: ReactNode }) {
  const t = NEXT_TONE[tone];
  return (
    <div className={`flex flex-col gap-3 rounded-xl border bg-gradient-to-r to-white p-4 sm:flex-row sm:items-center ${t.box}`}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-white shadow-sm ${t.dot}`}><Icon name={t.icon} size={15} strokeWidth={2.2} /></span>
        <div className="min-w-0">
          <div className={`text-2xs font-bold uppercase tracking-wider ${t.label}`}>{title}</div>
          <div className="mt-0.5 text-sm text-slate-700">{text}</div>
        </div>
      </div>
      {href && cta && <Link href={href} className="btn-primary shrink-0 self-start sm:self-auto">{cta}<Icon name="arrow-right" size={14} /></Link>}
      {children}
    </div>
  );
}

export function EmptyState({ icon = "inbox", title, text, href, cta, children }: { icon?: IconName; title: string; text?: ReactNode; href?: string; cta?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400"><Icon name={icon} size={20} /></span>
      <div className="mt-3 text-sm font-semibold text-slate-900">{title}</div>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
      {href && cta && <Link href={href} className="btn-primary mt-4">{cta}<Icon name="arrow-right" size={14} /></Link>}
      {children}
    </div>
  );
}

const CALLOUT: Record<"info" | "warn" | "danger" | "success", { box: string; icon: IconName; color: string }> = {
  info: { box: "border-sky-200 bg-sky-50/70 text-sky-950", icon: "info", color: "text-sky-600" },
  warn: { box: "border-amber-200 bg-amber-50/80 text-amber-950", icon: "alert", color: "text-amber-500" },
  danger: { box: "border-red-200 bg-red-50/80 text-red-950", icon: "x-circle", color: "text-red-600" },
  success: { box: "border-emerald-200 bg-emerald-50/70 text-emerald-950", icon: "check-circle", color: "text-emerald-600" },
};

/** Inline message box that stays on the page (toasts are for things that just happened). */
export function Callout({ tone = "info", title, children, action }: { tone?: keyof typeof CALLOUT; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const c = CALLOUT[tone];
  return (
    <div className={`flex flex-col gap-3 rounded-xl border p-3.5 text-sm sm:flex-row sm:items-center ${c.box}`}>
      <div className="flex min-w-0 flex-1 gap-2.5">
        <Icon name={c.icon} size={17} className={`mt-px ${c.color}`} />
        <div className="min-w-0 flex-1">
          {title && <div className="font-semibold">{title}</div>}
          {children && <div className={title ? "mt-0.5 opacity-80" : ""}>{children}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export type StepState = "done" | "current" | "todo";

/** Horizontal stepper for a flow (scrolls sideways on phones). */
export function Steps({ steps }: { steps: { label: string; state: StepState; href?: string }[] }) {
  return (
    <ol className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-0.5 scrollbar-none">
      {steps.map((s, i) => {
        const pill = (
          <span className={`inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-full pl-1 pr-3 text-xs font-medium transition ${
            s.state === "current" ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/25" : s.state === "done" ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15" : "bg-white text-slate-500 ring-1 ring-inset ring-slate-200"}`}>
            <span className={`grid h-6 w-6 place-items-center rounded-full text-2xs font-bold ${s.state === "current" ? "bg-white/20" : s.state === "done" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>
              {s.state === "done" ? <Icon name="check" size={12} strokeWidth={3} /> : i + 1}
            </span>
            {s.label}
          </span>
        );
        return (
          <li key={i} className="flex shrink-0 items-center gap-1">
            {i > 0 && <span className={`h-px w-4 ${s.state === "todo" ? "bg-slate-200" : "bg-emerald-300"}`} />}
            {s.href ? <Link href={s.href}>{pill}</Link> : pill}
          </li>
        );
      })}
    </ol>
  );
}

/** Form field: label with optional (i), the control, and a hint line. */
export function Field({ label, info, hint, children, className = "" }: { label: string; info?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="label flex items-center gap-1">{label}{info && <Info text={info} title={label} size={12} />}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Label + value pair for detail pages. */
export function KV({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className="mt-0.5 break-words text-sm text-slate-800">{children}</div>
    </div>
  );
}

export function Progress({ value, tone = "indigo" }: { value: number; tone?: "indigo" | "emerald" | "amber" }) {
  const pct = Math.round(Math.min(1, Math.max(0, value || 0)) * 100);
  const bar = tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-400" : "bg-indigo-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A mail shown like a small letter: subject on top, text below. tone="translation" for the English copy. */
export function MailPreview({ label, subject, text, tone = "mail", footer }: { label: string; subject?: ReactNode; text: string; tone?: "mail" | "translation"; footer?: ReactNode }) {
  const tr = tone === "translation";
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400">
        <Icon name={tr ? "globe" : "mail"} size={12} />{label}
      </div>
      <div className={`overflow-hidden rounded-lg border ${tr ? "border-indigo-100 bg-indigo-50/40" : "border-slate-200 bg-white"}`}>
        {subject !== undefined && <div className={`border-b px-3 py-2 text-sm font-semibold text-slate-900 ${tr ? "border-indigo-100" : "border-slate-100"}`}>{subject || "(subject nahi hai)"}</div>}
        <pre className="whitespace-pre-wrap break-words px-3 py-2.5 font-sans text-sm leading-relaxed text-slate-700">{text}</pre>
        {footer}
      </div>
    </div>
  );
}
