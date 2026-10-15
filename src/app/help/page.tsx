import Link from "next/link";
import type { ReactNode } from "react";
import type { Lang, T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { Icon, type IconName } from "@/components/icons";
import { ALL_NAV, MOBILE_TABS, NAV, pickText } from "@/components/nav";
import { Badge, Callout, NextStep, PageHeader, Section, type Tone } from "@/components/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Kaise use karein", "How to use") };
}

// The in-app guide: the flow from DRY-RUN to LIVE, every menu and button, what to put in the CSV, AI vs template,
// the safety rules and common fixes. Menu names come from nav.ts, so they always read exactly like the sidebar.
// <B> only draws a picture of a button: nothing on this page runs an action.

const MENUS = ALL_NAV.map((x) => x.href);
const menuId = (href: string) => `menu-${href === "/" ? "dashboard" : href.slice(1)}`;

/** A menu as the sidebar shows it, in the chosen language. */
function menuOf(href: string, lang: Lang) {
  const it = ALL_NAV.find((x) => x.href === href)!;
  const group = NAV.find((g) => g.items.includes(it))!;
  return { icon: it.icon, label: pickText(lang, it.label), short: pickText(lang, it.short), group: pickText(lang, group.title) };
}

/** Link to a menu, drawn like a small sidebar item. */
function MenuLink({ href, lang }: { href: string; lang: Lang }) {
  const m = menuOf(href, lang);
  return (
    <Link href={href} className="mx-px inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-indigo-50 px-1.5 py-px align-middle text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-600/15 transition hover:bg-indigo-100">
      <Icon name={m.icon} size={11} />{m.label}
    </Link>
  );
}

const BTN = {
  default: "border-slate-200 bg-white text-slate-700 shadow-sm",
  primary: "border-indigo-600 bg-indigo-600 text-white",
  success: "border-emerald-600 bg-emerald-600 text-white",
  danger: "border-red-600 bg-red-600 text-white",
  reject: "border-slate-200 bg-white text-red-600 shadow-sm",
  armed: "border-amber-500 bg-amber-500 text-white",
} as const;

/** A picture of one of the app's buttons (same colours and icon), not a button. */
function B({ children, v = "default", icon }: { children: ReactNode; v?: keyof typeof BTN; icon?: IconName }) {
  return (
    <span className={`mx-px inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-px align-middle text-xs font-medium leading-4 ${BTN[v]}`}>
      {icon && <Icon name={icon} size={11} strokeWidth={2} />}
      <span className="min-w-0">{children}</span>
    </span>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-slate-100 px-1 py-px font-mono text-[11px] text-slate-700 ring-1 ring-inset ring-slate-200/70 [overflow-wrap:anywhere]">{children}</code>;
}

/** Small uppercase heading inside a card. */
function Sub({ icon, children, className = "" }: { icon?: IconName; children: ReactNode; className?: string }) {
  return <h3 className={`mb-2 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400 ${className}`}>{icon && <Icon name={icon} size={12} />}{children}</h3>;
}

function Dots({ items, mark = "dot" }: { items: ReactNode[]; mark?: "dot" | "check" | "alert" }) {
  return (
    <ul className="space-y-1.5">
      {items.map((x, i) => (
        <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-600">
          {mark === "dot"
            ? <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
            : <Icon name={mark === "check" ? "check" : "alert"} size={14} strokeWidth={2.2} className={`mt-[3px] ${mark === "check" ? "text-emerald-600" : "text-amber-500"}`} />}
          <span className="min-w-0">{x}</span>
        </li>
      ))}
    </ul>
  );
}

type Def = { k: ReactNode; d: ReactNode };
/** Name (button, section, field) on the left, what it does on the right; stacked on phones. */
function Defs({ items }: { items: Def[] }) {
  return (
    <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200/80 bg-white">
      {items.map((x, i) => (
        <div key={i} className="px-3 py-2.5 sm:grid sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:gap-4">
          <dt className="min-w-0 text-sm font-medium leading-relaxed text-slate-900">{x.k}</dt>
          <dd className="mt-1 min-w-0 text-sm leading-relaxed text-slate-600 sm:mt-0">{x.d}</dd>
        </div>
      ))}
    </dl>
  );
}

function Feature({ icon, title, children, tone = "indigo" }: { icon: IconName; title: ReactNode; children: ReactNode; tone?: "indigo" | "emerald" }) {
  return (
    <div className="flex min-w-0 gap-3 rounded-lg border border-slate-200/80 bg-slate-50/50 p-3">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white shadow-sm ring-1 ring-inset ring-slate-200 ${tone === "emerald" ? "text-emerald-600" : "text-indigo-600"}`}><Icon name={icon} size={15} /></span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{children}</p>
      </div>
    </div>
  );
}

/** One numbered setup step with a link to the page where it is done. */
function StepRow({ n, title, href, cta, children }: { n: number; title: ReactNode; href: string; cta: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 px-4 py-4 sm:px-5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white shadow-sm shadow-indigo-600/30">{n}</span>
      <div className="min-w-0 flex-1">
        <h3 className="pt-1 text-sm font-semibold text-slate-900">{title}</h3>
        <div className="mt-1.5 space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
        <Link href={href} className="btn btn-sm mt-3">{cta}<Icon name="arrow-right" size={13} /></Link>
      </div>
    </li>
  );
}

function DayRow({ n, head, children }: { n: number; head: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-600 text-2xs font-bold text-white">{n}</span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-sm font-semibold text-slate-900">{head}</div>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{children}</p>
      </div>
    </li>
  );
}

/** One menu of the app as an accordion row: closed it shows what the menu is for, open it explains everything inside. */
function MenuRow({ href, lang, t, line, when, children }: { href: string; lang: Lang; t: T; line: ReactNode; when: ReactNode; children?: ReactNode }) {
  const m = menuOf(href, lang);
  return (
    <details id={menuId(href)} className="group/menu border-t border-slate-100 first:border-t-0">
      <summary className="flex cursor-pointer select-none items-center gap-3 px-4 py-3 transition hover:bg-slate-50/70 sm:px-5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 transition group-open/menu:bg-indigo-600 group-open/menu:text-white"><Icon name={m.icon} size={16} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-slate-900">{m.label}</span>
            <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400">{m.group}</span>
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-slate-500">{line}</span>
        </span>
        <Icon name="chevron-down" size={16} className="shrink-0 text-slate-400 transition group-open/menu:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-slate-100 bg-slate-50/50 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
          <p className="flex min-w-0 items-start gap-1.5 text-sm leading-relaxed text-slate-700">
            <Icon name="clock" size={14} className="mt-[3px] text-slate-400" />
            <span className="min-w-0"><b className="font-semibold text-slate-900">{t("Kab kholo:", "When to open it:")}</b> {when}</span>
          </p>
          <Link href={href} className="btn btn-sm shrink-0 self-start">{t("Ye page kholo", "Open this page")}<Icon name="arrow-right" size={13} /></Link>
        </div>
        {children}
      </div>
    </details>
  );
}

function Faq({ q, children }: { q: ReactNode; children: ReactNode }) {
  return (
    <details className="group/faq border-t border-slate-100 first:border-t-0">
      <summary className="flex cursor-pointer select-none items-start gap-3 px-4 py-3 transition hover:bg-slate-50/70 sm:px-5">
        <Icon name="chevron-right" size={15} className="mt-0.5 shrink-0 text-slate-400 transition group-open/faq:rotate-90" />
        <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">{q}</span>
      </summary>
      <div className="space-y-2 pb-4 pl-11 pr-4 text-sm leading-relaxed text-slate-600 sm:pl-12 sm:pr-5">{children}</div>
    </details>
  );
}

/** A part of the screen: a small drawing of it, its name and what it does. */
function Part({ visual, title, children }: { visual: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-slate-200/80 bg-white p-3">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md bg-slate-50 px-2.5 py-2 ring-1 ring-inset ring-slate-200/60">{visual}</div>
      <div className="mt-2.5 text-sm font-semibold text-slate-900">{title}</div>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{children}</p>
    </div>
  );
}

function ModePill({ live }: { live?: boolean }) {
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 align-middle text-2xs font-bold ring-1 ring-inset ${live ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-amber-50 text-amber-700 ring-amber-600/20"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-amber-500"}`} />{live ? "LIVE" : "DRY-RUN"}
    </span>
  );
}

const TOAST: Record<"success" | "error" | "warning", { icon: IconName; color: string; bar: string }> = {
  success: { icon: "check-circle", color: "text-emerald-600", bar: "bg-emerald-500" },
  error: { icon: "x-circle", color: "text-red-600", bar: "bg-red-500" },
  warning: { icon: "alert", color: "text-amber-500", bar: "bg-amber-400" },
};
function ToastPic({ kind, title }: { kind: keyof typeof TOAST; title: string }) {
  const k = TOAST[kind];
  return (
    <span className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-md bg-white py-1 pl-2.5 pr-2 text-2xs font-semibold text-slate-800 shadow-sm ring-1 ring-slate-900/[.07]">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${k.bar}`} />
      <Icon name={k.icon} size={12} className={k.color} />{title}
    </span>
  );
}

function ModeCard({ live, tag, points }: { live?: boolean; tag: string; points: ReactNode[] }) {
  const look = live
    ? { box: "border-emerald-200 from-emerald-50", chip: "bg-emerald-600 shadow-emerald-600/30", text: "text-emerald-700", dot: "bg-emerald-500" }
    : { box: "border-amber-200 from-amber-50", chip: "bg-amber-500 shadow-amber-500/30", text: "text-amber-700", dot: "bg-amber-400" };
  return (
    <div className={`min-w-0 rounded-xl border bg-gradient-to-br to-white p-4 ${look.box}`}>
      <div className="flex items-center gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white shadow-sm ${look.chip}`}><Icon name={live ? "zap" : "flask"} size={17} strokeWidth={2} /></span>
        <div className="min-w-0">
          <div className={`text-lg font-bold leading-tight tracking-tight ${look.text}`}>{live ? "LIVE" : "DRY-RUN"}</div>
          <div className="text-2xs font-bold uppercase tracking-wider text-slate-500">{tag}</div>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {points.map((p, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
            <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${look.dot}`} /><span className="min-w-0">{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Option({ icon, title, tag, points, when }: { icon: IconName; title: ReactNode; tag: string; points: ReactNode[]; when: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-slate-200/80 bg-white p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-600 text-white shadow-sm shadow-indigo-600/30"><Icon name={icon} size={17} /></span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="text-2xs font-bold uppercase tracking-wider text-slate-400">{tag}</div>
        </div>
      </div>
      <div className="mt-3 flex-1"><Dots items={points} mark="check" /></div>
      <p className="mt-3 rounded-lg bg-indigo-50/70 px-3 py-2 text-xs leading-relaxed text-indigo-900 ring-1 ring-inset ring-indigo-600/10">{when}</p>
    </div>
  );
}

// the first row of the sample CSV on the Import page (.example addresses can never be mailed)
const CSV_EXAMPLE = {
  email: "contact@trattoria-roma.example", business_name: "Trattoria Roma", contact_name: "Marco", website: "trattoria-roma.example", city: "Lyon", country: "France",
  category: "Italian restaurant", about: "Fresh pasta, pizza and takeaway; private room for events", note: "4.8★ with 300 Google reviews", phone: "+33 4 78 00 00 00",
};
type CsvColumn = keyof typeof CSV_EXAMPLE;
const csvCell = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const CSV_TEXT = `${Object.keys(CSV_EXAMPLE).join(",")}\n${Object.values(CSV_EXAMPLE).map(csvCell).join(",")}`;

const TPL = "Hello {{contact|there}},\nWe at {{my_business}} work with businesses like {{business}} in {{city|your area}}.";
const TPL_FULL = "Hello Marco,\nWe at Brighton Solution work with businesses like Trattoria Roma in Lyon.";
const TPL_EMPTY = "Hello there,\nWe at Brighton Solution work with businesses like Trattoria Roma in your area.";

export default async function HelpPage() {
  const { t, lang } = await getT();
  const M = (href: string) => <MenuLink href={href} lang={lang} />;
  const m = (href: string) => menuOf(href, lang);

  const toc: { id: string; icon: IconName; label: string }[] = [
    { id: "overview", icon: "send", label: t("Ye software kya karta hai", "What this software does") },
    { id: "test-live", icon: "flask", label: t("Test (DRY-RUN) aur LIVE", "Test (DRY-RUN) and LIVE") },
    { id: "setup", icon: "flag", label: t("Pehli baar setup (7 steps)", "First-time setup (7 steps)") },
    { id: "daily", icon: "calendar", label: t("Roz ka kaam", "Daily routine") },
    { id: "screen", icon: "grid", label: t("Screen ke hisse", "Parts of the screen") },
    { id: "menus", icon: "list", label: t("Har menu ka kaam", "Every menu explained") },
    { id: "csv", icon: "file", label: t("CSV mein kya dena hai", "What to put in the CSV") },
    { id: "ai-template", icon: "bot", label: t("AI ya Template", "AI or Template") },
    { id: "safety", icon: "shield", label: t("Safety ke niyam", "Safety rules") },
    { id: "faq", icon: "alert", label: t("Problem aaye to", "Problems and fixes") },
    { id: "words", icon: "message", label: t("Mushkil shabd", "Tricky words") },
  ];
  const inGuide = t("Is guide mein", "In this guide");

  const need: Record<"req" | "rec" | "use" | "opt", { label: string; tone: Tone }> = {
    req: { label: t("Zaroori", "Required"), tone: "red" },
    rec: { label: t("Behtar hai", "Recommended"), tone: "indigo" },
    use: { label: t("Bahut kaam ka", "Very useful"), tone: "emerald" },
    opt: { label: "Optional", tone: "slate" },
  };
  // field = the name of the matching field on the Import screen (where the file's columns are mapped)
  const columns: { c: CsvColumn; need: keyof typeof need; field: string; what: string }[] = [
    { c: "email", need: "req", field: "Email *", what: t("Business ka email. Ek row mein ek email.", "The business's email. One email per row.") },
    { c: "business_name", need: "rec", field: t("Business ka naam", "Business name"), what: t("Business ka naam. Mail aur subject mein aata hai.", "The business name. Used in the mail and the subject.") },
    { c: "contact_name", need: "rec", field: t("Contact ka naam", "Contact name"), what: t("Owner ya manager ka first name: mail ‘Hello Marco,’ se shuru hoti hai. Pata na ho to khaali chhodo.", "The owner's or manager's first name: the mail starts with ‘Hello Marco,’. Leave it empty if you don't know it.") },
    { c: "website", need: "rec", field: "Website", what: t("Business ki website. Isse pakka hota hai ki ek business ko ek hi mail jaye. AI sirf iska title aur description padhta hai, ye samajhne ke liye ki business kya karta hai.", "The business website. It makes sure one business gets only one mail. The AI reads only its title and description, to understand what the business does.") },
    { c: "city", need: "rec", field: t("Shehar", "City"), what: t("Shehar, jaise mail mein ‘in Lyon’.", "The city, e.g. ‘in Lyon’ in the mail.") },
    { c: "country", need: "rec", field: t("Desh", "Country"), what: t("Desh. Isse mail ki bhasha aur timezone (sending window) set hote hain.", "The country. It sets the mail language and the timezone (sending window).") },
    { c: "category", need: "use", field: t("Business ka type", "Type of business"), what: t("Kis tarah ka business: ‘Italian restaurant’, ‘dental clinic’, ‘hair salon’.", "What kind of business: ‘Italian restaurant’, ‘dental clinic’, ‘hair salon’.") },
    { c: "about", need: "use", field: t("Business kya karta hai", "What they do"), what: t("Wo kya karte ya bechte hain, aapke shabdon mein (1 line).", "What they do or sell, in your words (1 line).") },
    { c: "note", need: "use", field: t("Ek sach baat", "One true fact"), what: t("Ek sach baat jo aapne khud dekhi aur pakka pata hai. AI ise ek baar, chhota sa use kar sakta hai.", "One true fact you checked yourself. The AI may mention it once, briefly.") },
    { c: "phone", need: "opt", field: "Phone", what: t("Sirf aapke record ke liye. Mail mein nahi aata.", "Only for your records. Not used in the mail.") },
  ];
  const placeholders: { p: string; means: string; ex: string }[] = [
    { p: "{{business}}", means: t("Business ka naam (business_name)", "Business name (business_name)"), ex: "Trattoria Roma" },
    { p: "{{contact|there}}", means: t("contact_name; khaali ho to ‘there’", "contact_name; ‘there’ if it is empty"), ex: "Marco" },
    { p: "{{city|your area}}", means: t("city; khaali ho to ‘your area’", "city; ‘your area’ if it is empty"), ex: "Lyon" },
    { p: "{{category|small businesses}}", means: t("category; khaali ho to ‘small businesses’", "category; ‘small businesses’ if it is empty"), ex: "Italian restaurant" },
    { p: "{{country}}", means: "country", ex: "France" },
    { p: "{{my_name}}", means: t("Aapka Naam (Settings → Sender profile)", "Your Name (Settings → Sender profile)"), ex: t("Aapka naam", "Your name") },
    { p: "{{my_business}}", means: t("Aapka Business (Settings → Sender profile)", "Your Business (Settings → Sender profile)"), ex: "Brighton Solution" },
  ];

  const words: { w: string; d: string }[] = [
    { w: "Lead", d: t("Ek business jise aap mail bhejna chahte ho. CSV ki ek row = ek lead.", "A business you want to email. One CSV row = one lead.") },
    { w: "Campaign", d: t("Ek list + bhasha + timezone + mail ka tarika (AI ya Template). Isi se mails banti aur jaati hain.", "One list + language + timezone + how mails are written (AI or Template). Mails are made and sent through it.") },
    { w: "Draft", d: t("Mail jo ban chuki hai par abhi gayi nahi.", "A mail that is written but not sent yet.") },
    { w: "DRY-RUN", d: t("Test mode: har mail sirf aapke Test address pe jaati hai.", "Test mode: every mail goes only to your Test address.") },
    { w: "LIVE", d: t("Asli mode: approve ki hui mails asli leads ko jaati hain.", "Real mode: approved mails go to the real leads.") },
    { w: "Worker", d: t("Server pe chalne wala program. Har minute chalta hai: drafts banata hai, zyada se zyada ek mail bhejta hai, aur har 10 minute mein inbox padhta hai.", "A program running on the server. It runs every minute: writes drafts, sends at most one mail, and reads the inbox every 10 minutes.") },
    { w: "Sending window", d: t("Din ka wo samay (jaise 09:30-17:30, lead ke timezone mein) jab mails jaati hain.", "The time of day (e.g. 09:30-17:30, in the lead's timezone) when mails go out.") },
    { w: "Daily limit", d: t("Ek din mein zyada se zyada kitni mails jaayengi.", "The most mails that go out in one day.") },
    { w: "Warm-up", d: t("Naye domain ki daily limit ko dheere-dheere badhana, taaki mails spam mein na jaayein.", "Raising a new domain's daily limit slowly, so mails don't land in spam.") },
    { w: "Ledger", d: t("Jinhe kabhi bhi mail gayi, unki permanent list. Inhe dobara cold mail kabhi nahi.", "The permanent list of everyone ever mailed. They never get another cold mail.") },
    { w: t("Block List", "Block list"), d: t("Jinhe kabhi mail nahi bhejni: ek email ya poora domain.", "Who never gets a mail: a single email or a whole domain.") },
    { w: "Bounce", d: t("Mail wapas aa gayi. Hard bounce = address galat ya band; soft bounce = abhi ki problem (jaise inbox full).", "The mail came back. Hard bounce = wrong or closed address; soft bounce = a temporary problem (e.g. a full inbox).") },
    { w: "Opt-out", d: t("Lead ne aage mail na bhejne ko kaha (jaise STOP reply). Apne aap Block List mein.", "The lead asked not to be mailed again (e.g. a STOP reply). Added to the Block list automatically.") },
    { w: "Auto-reply", d: t("Apne aap aane wala jawab, jaise ‘out of office’.", "An automatic answer, like ‘out of office’.") },
    { w: "Manual check", d: t("Pata nahi mail gayi ya nahi. Aap Sent folder dekh ke batate ho.", "Unclear whether the mail went out. You check the Sent folder and mark it.") },
    { w: t("Review chahiye", "Needs review"), d: t("Address kisi insaan ka personal lagta hai. Aap approve ya reject karte ho.", "The address looks like a person's private one. You approve or reject it.") },
    { w: "SMTP / IMAP", d: t("SMTP = mail bhejne ka raasta. IMAP = inbox padhne ka raasta (replies, bounce).", "SMTP = the way mail is sent. IMAP = the way the inbox is read (replies, bounces).") },
    { w: "SPF / DKIM / DMARC", d: t("Domain ke DNS records jo saabit karte hain ki mail sach mein aapke domain se aayi. SPF aur DKIM ke bina mails spam mein jaati hain.", "DNS records that prove a mail really comes from your domain. Without SPF and DKIM, mails land in spam.") },
    { w: "MX record", d: t("Domain ka record jo batata hai ki wo mail le sakta hai. MX nahi = mail nahi pahunchegi, isliye import mein skip.", "A domain record that says it can receive mail. No MX = mail cannot arrive, so the row is skipped at import.") },
    { w: "Role address", d: t("jobs@, privacy@, noreply@ jaise kaam ke address. Inhe mail nahi bhejte; import mein skip.", "Function addresses like jobs@, privacy@, noreply@. They are never mailed and are skipped at import.") },
    { w: "From name", d: t("Lead ke inbox mein dikhne wala naam, jaise Brighton Solution.", "The name shown in the lead's inbox, e.g. Brighton Solution.") },
    { w: "Signature / Footer", d: t("Mail ke neeche. Signature = aapka naam, role, website. Footer = address kahan mila, STOP se mail band karne ka tarika aur postal address. Dono app khud lagata hai.", "At the end of each mail. Signature = your name, role, website. Footer = where the address was found, how to stop mails with STOP, and your postal address. The app adds both itself.") },
    { w: "Placeholder", d: t("Template mein {{...}} wali jagah, jo har lead ki details se bharti hai.", "A {{...}} spot in a template that is filled with each lead's details.") },
    { w: "Toast", d: t("Button dabane ke baad aane wala chhota popup.", "The small pop-up that appears after you press a button.") },
  ];

  const tocCard = (
    <nav aria-label={inGuide} className="card !p-3 xl:hidden">
      <div className="mb-2 px-1 text-2xs font-bold uppercase tracking-wider text-slate-400">{inGuide}</div>
      <ol className="grid grid-cols-2 gap-1 md:grid-cols-3">
        {toc.map((s) => (
          <li key={s.id} className="min-w-0">
            <a href={`#${s.id}`} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 active:bg-slate-100">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-500"><Icon name={s.icon} size={13} /></span>
              <span className="min-w-0 leading-tight">{s.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );

  const tocSide = (
    <aside className="hidden xl:sticky xl:top-20 xl:block">
      <nav aria-label={inGuide} className="max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-xl border border-slate-200/80 bg-white p-2 shadow-card [scrollbar-width:thin]">
        <div className="px-2 pb-1 pt-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400">{inGuide}</div>
        <ol className="space-y-px">
          {toc.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
                <Icon name={s.icon} size={13} className="text-slate-400" /><span className="min-w-0 leading-tight">{s.label}</span>
              </a>
              {s.id === "menus" && (
                <ol className="mb-1 ml-[15px] space-y-px border-l border-slate-200 pl-1.5">
                  {MENUS.map((href) => (
                    <li key={href}>
                      <a href={`#${menuId(href)}`} className="block truncate rounded px-2 py-1 text-2xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">{m(href).label}</a>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </aside>
  );

  return (
    <div>
      <PageHeader
        title={t("Kaise use karein", "How to use")}
        info={t(
          "Poore software ki aasaan guide. Upar se neeche padho, ya list se seedha kisi topic pe jao. 'Har menu ka kaam' mein kisi bhi menu pe click karo: uske andar ka har section aur button samjhaya gaya hai.",
          "A simple guide to the whole software. Read it top to bottom, or jump to any topic from the list. Under 'Every menu explained', click any menu to see every section and button inside it.",
        )}
        sub={t(
          "Test (DRY-RUN) se LIVE tak ka flow, har menu aur button ka kaam, aur CSV mein kya dena hai.",
          "The flow from Test (DRY-RUN) to LIVE, what every menu and button does, and what to put in the CSV.",
        )}
      />

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_212px] xl:items-start xl:gap-6">
        <div className="min-w-0 space-y-5">
          {tocCard}

          <NextStep title={t("Kahan se shuru karein?", "Where to start?")} href="#setup" cta={t("Setup ke steps", "Setup steps")}
            text={t(
              <>Pehli baar? <b>Pehli baar setup</b> ke 7 steps isi order mein karo. Setup ho chuka hai to <b>Roz ka kaam</b> dekho. Koi shabd samajh na aaye to aakhir mein <b>Mushkil shabd</b> dekho.</>,
              <>First time? Do the 7 steps of <b>First-time setup</b> in that order. Already set up? See <b>Daily routine</b>. If a word is unclear, see <b>Tricky words</b> at the end.</>,
            )} />

          {/* ---------------- 1. what it does ---------------- */}
          <Section id="overview" icon="send" title={t("Ye software kya karta hai", "What this software does")}
            sub={t("Aapke mailbox se, aapke naam se, har business ko sirf ek soch-samajh ke likhi mail", "From your mailbox, in your name: one carefully written mail to each business")}>
            <p className="text-sm leading-relaxed text-slate-700">
              {t(
                "Ye app naye business leads ko cold email bhejta hai: aapke apne mailbox (Hostinger) se, dheere aur safe tarike se. Har lead ko sirf ek mail jaati hai, aur koi bhi mail aapke approve kiye bina nahi jaati.",
                "This app sends cold emails to new business leads from your own mailbox (Hostinger), slowly and safely. Each lead gets only one mail, and no mail goes out without your approval.",
              )}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Feature icon="mail" title={t("Har lead ko sirf ek mail", "Only one mail per lead")}>
                {t("Koi follow-up nahi, koi doosri mail nahi. Ledger yaad rakhta hai ki kisko mail gayi.", "No follow-ups, no second mail. The Ledger remembers who was mailed.")}
              </Feature>
              <Feature icon="bot" title={t("AI ya fixed template", "AI or a fixed template")}>
                {t("Mail AI likhta hai (har lead ke liye alag), ya aapka fixed template use hota hai.", "The AI writes each mail (different for every lead), or your fixed template is used.")}
              </Feature>
              <Feature icon="check-check" title={t("Har mail aap approve karte ho", "You approve every mail")}>
                {t("Aapke approve kiye bina koi mail nahi jaati.", "No mail goes out without your approval.")}
              </Feature>
              <Feature icon="clock" title={t("Dheere aur safe sending", "Slow, safe sending")}>
                {t("Sirf sending window mein, har mail ke beech gap, roz ki limit ke andar.", "Only inside the sending window, with a gap between mails, within a daily limit.")}
              </Feature>
              <Feature icon="inbox" title={t("Replies apne aap track", "Replies tracked automatically")}>
                {t("Reply, opt-out aur bounce inbox se apne aap pakde jaate hain.", "Replies, opt-outs and bounces are picked up from the inbox automatically.")}
              </Feature>
              <Feature icon="user" title={t("Aapke naam se", "In your name")}>
                {t("Har lead ko mail aapke From name (jaise Brighton Solution) se dikhti hai.", "Every lead sees the mail from your From name (e.g. Brighton Solution).")}
              </Feature>
            </div>

            <Sub icon="arrow-right" className="mt-5">{t("Poora flow ek nazar mein", "The whole flow at a glance")}</Sub>
            <ol className="grid gap-2 md:grid-cols-5">
              {([
                { icon: "upload", title: m("/import").label, text: t("Leads ki list daalo; app har address check karta hai", "Add a list of leads; the app checks every address") },
                { icon: "megaphone", title: m("/campaigns").label, text: t("Campaign banao; AI ya template 5 sample mails banata hai", "Create a campaign; the AI or a template makes 5 sample mails") },
                { icon: "check-check", title: m("/review").label, text: t("Har mail padho aur approve karo", "Read and approve every mail") },
                { icon: "send", title: t("Worker bhejta hai", "The worker sends"), text: t("Sending window mein, ek-ek karke, gap ke saath", "In the sending window, one by one, with a gap") },
                { icon: "inbox", title: m("/replies").label, text: t("Jawab yahan aate hain; reply apne webmail se karo", "Answers land here; reply from your webmail") },
              ] as { icon: IconName; title: string; text: string }[]).map((s, i) => (
                <li key={i} className="flex min-w-0 items-start gap-3 rounded-lg border border-slate-200/80 bg-white p-3 md:block">
                  <div className="mt-px flex shrink-0 items-center gap-2 md:mt-0">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-600 text-2xs font-bold text-white">{i + 1}</span>
                    <Icon name={s.icon} size={15} className="text-indigo-500" />
                  </div>
                  <div className="min-w-0 md:mt-2">
                    <div className="text-sm font-semibold text-slate-900">{s.title}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{s.text}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          {/* ---------------- 2. test vs live ---------------- */}
          <Section id="test-live" icon="flask" title={t("Test (DRY-RUN) aur LIVE", "Test (DRY-RUN) and LIVE")}
            sub={t("Do mode: pehle test karo, phir asli leads ko bhejo", "Two modes: test first, then send to real leads")}>
            <div className="grid gap-3 md:grid-cols-2">
              <ModeCard tag={t("Test mode", "Test mode")} points={[
                t(<>Har approve ki hui mail sirf aapke <b>Test address</b> pe jaati hai (Settings mein bharo).</>, <>Every approved mail goes only to your <b>Test address</b> (set it in Settings).</>),
                t("Kisi bhi lead ko kuch nahi jaata.", "No lead gets anything."),
                t(<>Test mail ke subject ke aage <Code>{"[DRY RUN → lead ka email]"}</Code> likha hota hai, taaki aap pehchaan sako.</>, <>A test mail&apos;s subject starts with <Code>{"[DRY RUN → the lead's email]"}</Code>, so you can recognise it.</>),
                t("Bhejne ka tarika LIVE jaisa hi hai: sending window, gap aur roz ki limit yahan bhi lagte hain, isliye test mails bhi dheere aati hain.", "Sending works just like LIVE: the sending window, the gap and the daily limit apply here too, so test mails also arrive slowly."),
                t(<>Bheji gayi test mails {M("/sent")} ke <b>Dry-run</b> tab mein dikhti hain.</>, <>Sent test mails show in the <b>Dry-run</b> tab of {M("/sent")}.</>),
              ]} />
              <ModeCard live tag={t("Asli mode", "Real mode")} points={[
                t("Approve ki hui mails asli leads ko jaati hain.", "Approved mails go to the real leads."),
                t("Sirf sending window ke andar, chune hue dino mein, roz ki limit tak.", "Only inside the sending window, on the chosen days, up to the daily limit."),
                t("Har live mail ki copy aapke mailbox ke Sent folder mein bhi hoti hai.", "Every live mail also has a copy in your mailbox's Sent folder."),
                t("Kabhi bhi ek click mein wapas DRY-RUN kar sakte ho.", "You can go back to DRY-RUN at any time with one click."),
              ]} />
            </div>

            <Sub icon="sliders" className="mt-5">{t("Mode kahan badalta hai?", "Where do you switch the mode?")}</Sub>
            <ol className="space-y-2.5">
              {[
                t(<>{M("/")} kholo. Wahan <b>Sending mode</b> card hai.</>, <>Open {M("/")}. It has the <b>Sending mode</b> card.</>),
                t(
                  <>LIVE ke liye <B v="primary" icon="zap">LIVE karo</B> dabao. Button peela ho jaata hai: <B v="armed" icon="alert">Dobara dabao: mails asli leads ko jayengi</B>. 5 second ke andar dobara dabao, tabhi LIVE hota hai.</>,
                  <>To go live, press <B v="primary" icon="zap">Go LIVE</B>. The button turns amber: <B v="armed" icon="alert">Click again: mails will go to real leads</B>. Press it again within 5 seconds; only then does LIVE turn on.</>,
                ),
                t(<>Wapas test pe jaane ke liye <B icon="flask">Wapas DRY-RUN karo</B> dabao (ek click).</>, <>To go back to testing, press <B icon="flask">Back to DRY-RUN</B> (one click).</>),
                t(<>LIVE tabhi on hota hai jab Settings mein <b>Test address</b> bhara ho. Settings save karne se mode kabhi nahi badalta.</>, <>LIVE only turns on when a <b>Test address</b> is set in Settings. Saving Settings never changes the mode.</>),
                t(
                  <>Abhi ka mode har page pe dikhta hai: <ModePill /> ya <ModePill live />. Phone pe upar ki bar mein, computer pe sidebar ke neeche (sidebar chhota ho to upar). Is pe click karo to Sending mode card khulta hai.</>,
                  <>The current mode shows on every page: <ModePill /> or <ModePill live />. On phones in the top bar, on a computer at the bottom of the sidebar (in the top bar when the sidebar is collapsed). Click it to open the Sending mode card.</>,
                ),
              ].map((x, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-slate-600">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-100 text-2xs font-bold text-slate-500">{i + 1}</span>
                  <span className="min-w-0">{x}</span>
                </li>
              ))}
            </ol>

            <div className="mt-4">
              <Callout tone="warn" title={t("Dhyan do: approval yaad rehta hai", "Careful: approvals are kept")}>
                {t(
                  "DRY-RUN mein approve ki hui mail approve hi rehti hai. LIVE karte hi wahi mails asli leads ko jaane lagti hain, chahe wo pehle test address pe ja chuki hon. Isliye DRY-RUN mein bhi sirf wahi approve karo jo sach mein lead ko bhejni hai. Approve ki hui koi mail rokni ho to us lead ka email Block List mein daal do.",
                  "A mail approved in DRY-RUN stays approved. As soon as you go LIVE, those same mails start going to the real leads, even if they already went to your test address. So even in DRY-RUN, only approve what you really want the lead to get. To stop an approved mail, add that lead's email to the Block list.",
                )}
              </Callout>
            </div>
          </Section>

          {/* ---------------- 3. first-time setup ---------------- */}
          <Section flush id="setup" icon="flag" title={t("Pehli baar setup: 7 steps", "First-time setup: 7 steps")}
            sub={t("Isi order mein karo. Dashboard ka Setup guide bhi yahi 7 steps dikhata hai.", "Do them in this order. The Setup guide on the Dashboard shows the same 7 steps.")}>
            <ol className="divide-y divide-slate-100">
              <StepRow n={1} title={t("Settings bharo", "Fill in Settings")} href="/settings" cta={t("Settings kholo", "Open settings")}>
                <p>{t(<>{M("/settings")} kholo aur ye bharo:</>, <>Open {M("/settings")} and fill in:</>)}</p>
                <Dots items={[
                  t(
                    <><b>Mailbox</b>: <b>From address</b> (aapke domain ka email, isi se mail jaati hai), <b>Test address</b> (aapka personal email, test mails yahan aati hain), <b>Alert address</b> (alerts aur daily report; khaali = Test address).</>,
                    <><b>Mailbox</b>: <b>From address</b> (an email on your domain; mail goes out from it), <b>Test address</b> (your personal email; test mails arrive here), <b>Alert address</b> (alerts and the daily report; empty = Test address).</>,
                  ),
                  t(
                    <><b>Sender profile</b>: Naam, Role, Business, Website aur <b>Postal address</b> (har mail ke footer mein, zaroori).</>,
                    <><b>Sender profile</b>: Name, Role, Business, Website and <b>Postal address</b> (in every mail&apos;s footer, required).</>,
                  ),
                  t(
                    <><b>Inbox mein naam (From name)</b>: jaise <b>Brighton Solution</b>. Har lead ko inbox aur phone notification mein yahi naam dikhta hai. Khaali chhodo to Business ka naam use hota hai.</>,
                    <><b>Name in the inbox (From name)</b>: e.g. <b>Brighton Solution</b>. Every lead sees this name in the inbox and in phone notifications. Leave it empty to use the Business name.</>,
                  ),
                  t(
                    <><b>Offer notes</b>: aap kya offer karte ho, sach proof points aur tone. AI sirf inhi baaton ka use karta hai.</>,
                    <><b>Offer notes</b>: what you offer, true proof points and the tone. The AI uses only these points.</>,
                  ),
                ]} />
                <p>{t(
                  <>Phir neeche <B v="primary" icon="check">Settings save karo</B> dabao. Password aur AI key yahan nahi daalte: wo server ki .env file mein hoti hain.</>,
                  <>Then press <B v="primary" icon="check">Save settings</B> at the bottom. Passwords and the AI key are not entered here: they live in the server&apos;s .env file.</>,
                )}</p>
              </StepRow>

              <StepRow n={2} title={t("Test mail bhejo aur DNS check karo", "Send a test mail and check DNS")} href="/settings#check" cta={t("Connection test kholo", "Open connection test")}>
                <p>{t(
                  <>Settings ke <b>Connection test</b> card mein <B icon="mail">Test mail mujhe bhejo</B> dabao. Mail aapke Test address pe aani chahiye (spam folder bhi dekho). Usme From name, signature aur footer check karo.</>,
                  <>In the <b>Connection test</b> card of Settings, press <B icon="mail">Send test mail to me</B>. The mail should arrive at your Test address (check spam too). Check the From name, signature and footer in it.</>,
                )}</p>
                <p>{t(
                  <>Phir <B icon="shield">DNS check karo</B> dabao. <b>SPF</b> aur <b>DKIM</b> dono ke saamne <Badge v="ok" label="theek hai" tone="emerald" /> aana chahiye. Missing ho to Hostinger hPanel ke DNS Zone mein record theek karo. Iske bina campaign start nahi hota.</>,
                  <>Then press <B icon="shield">Check DNS</B>. Both <b>SPF</b> and <b>DKIM</b> must show <Badge v="ok" label="OK" tone="emerald" />. If one is missing, fix the record in the DNS Zone of Hostinger hPanel. No campaign can start without them.</>,
                )}</p>
              </StepRow>

              <StepRow n={3} title={t("Purane contacts Ledger mein daalo", "Add past contacts to the Ledger")} href="/ledger" cta={t("Ledger kholo", "Open ledger")}>
                <p>{t(
                  <>{M("/ledger")} mein <B v="primary" icon="download">Sent folder import karo</B> dabao. Aapke mailbox ke Sent folder ke saare address Ledger mein aa jaate hain, aur ye app unhe kabhi cold mail nahi bhejta.</>,
                  <>In {M("/ledger")}, press <B v="primary" icon="download">Import Sent folder</B>. Every address in your mailbox&apos;s Sent folder goes into the Ledger, and the app never cold-mails them.</>,
                )}</p>
                <p>{t(
                  <>Kisi aur mailbox (Gmail, Outlook) se mail kiye log? Unke address <B v="primary" icon="plus">Ledger mein daalo</B> se add karo. Jinhe kabhi mail nahi bhejni (competitor, apni company), unhe {M("/suppression")} mein daalo.</>,
                  <>People you mailed from another mailbox (Gmail, Outlook)? Add their addresses with <B v="primary" icon="plus">Add to ledger</B>. Anyone you never want to mail (competitors, your own company) goes into {M("/suppression")}.</>,
                )}</p>
              </StepRow>

              <StepRow n={4} title={t("Leads ki list import karo", "Import a list of leads")} href="/import" cta={t("Import kholo", "Open Import")}>
                <p>{t(
                  <>{M("/import")} mein pehle <b>Ye addresses kahan se mile?</b> bharo (jaise Google Maps). Ye har mail ke footer mein sach-sach likha jaata hai.</>,
                  <>In {M("/import")}, first fill in <b>Where did you find these addresses?</b> (e.g. Google Maps). It is written truthfully in every mail&apos;s footer.</>,
                )}</p>
                <p>{t(
                  <>File chuno (CSV, Excel, PDF, TXT) ya text paste karo → <B v="primary" icon="file-up">File / text padho</B> → columns match karo → <B v="primary" icon="eye">Check karke preview dekho</B> → result dekho → <B v="primary" icon="check">Import confirm karo</B>.</>,
                  <>Choose a file (CSV, Excel, PDF, TXT) or paste text → <B v="primary" icon="file-up">Read file / text</B> → map the columns → <B v="primary" icon="eye">Check &amp; preview</B> → check the result → <B v="primary" icon="check">Confirm import</B>.</>,
                )}</p>
                <p>{t(
                  <>Pehli baar? <B icon="download">Sample CSV download karo</B> aur usi format mein list banao. CSV mein kaunsi details deni hain, wo neeche <a href="#csv" className="link">CSV mein kya dena hai</a> mein hai. Sirf ek lead daalni ho to <b>Ek lead add karo</b> form use karo.</>,
                  <>First time? <B icon="download">Download sample CSV</B> and build your list in the same format. Which details to put in the CSV is explained below in <a href="#csv" className="link">What to put in the CSV</a>. To add just one lead, use the <b>Add a single lead</b> form.</>,
                )}</p>
                <p>{t(
                  <>Confirm ke baad <Badge v="needs_review" /> wale leads {M("/contacts")} mein approve ya reject karo.</>,
                  <>After confirming, approve or reject the <Badge v="needs_review" /> leads in {M("/contacts")}.</>,
                )}</p>
              </StepRow>

              <StepRow n={5} title={t("Campaign banao, 5 samples padho aur start karo", "Create a campaign, read 5 samples and start")} href="/campaigns" cta={t("Campaigns kholo", "Open campaigns")}>
                <p>{t(
                  <>{M("/campaigns")} mein list chuno, bhasha aur timezone check karo, aur <b>Mail kaise banegi</b> mein <b>AI har lead ke liye likhega</b> ya <b>Template 1/2/3</b> chuno. Phir <B v="primary" icon="plus">Campaign banao</B>. Isse abhi koi mail nahi jaati.</>,
                  <>In {M("/campaigns")}, choose the list, check the language and timezone, and under <b>How mails are written</b> pick <b>AI writes each mail</b> or <b>Template 1/2/3</b>. Then press <B v="primary" icon="plus">Create campaign</B>. No mail goes out yet.</>,
                )}</p>
                <p>{t(
                  <>Campaign page pe <B icon="bot">5 sample drafts banao</B> dabao aur paanchon mails dhyan se padho. Koi pasand na aaye to us pe <B icon="refresh">Naya version likho</B>.</>,
                  <>On the campaign page, press <B icon="bot">Make 5 sample drafts</B> and read all five mails carefully. If you don&apos;t like one, press <B icon="refresh">Write a new version</B> on it.</>,
                )}</p>
                <p>{t(
                  <>Sab theek ho to <B v="primary" icon="play">Samples theek hain: approve karke start karo</B> do baar dabao. Start se pehle app DNS (SPF, DKIM) dobara check karta hai.</>,
                  <>If all is good, press <B v="primary" icon="play">Samples look good: approve and start</B> twice. Before starting, the app checks DNS (SPF, DKIM) again.</>,
                )}</p>
              </StepRow>

              <StepRow n={6} title={t("Mails approve karo, pehli mail jaane do", "Approve mails and let the first one go")} href="/review" cta={t("Approve page kholo", "Open Approve page")}>
                <p>{t(
                  <>Abhi DRY-RUN mein hi raho. {M("/review")} pe har mail padho aur <B v="success" icon="check">Approve karo</B> dabao.</>,
                  <>Stay in DRY-RUN for now. On {M("/review")}, read each mail and press <B v="success" icon="check">Approve</B>.</>,
                )}</p>
                <p>{t(
                  <>Worker sending window mein inhe aapke Test address pe bhejta hai. Apne inbox mein aur {M("/sent")} ke <b>Dry-run</b> tab mein dekho ki mail bilkul sahi dikh rahi hai: From name, text, signature, footer.</>,
                  <>The worker sends them to your Test address inside the sending window. Check in your inbox and in the <b>Dry-run</b> tab of {M("/sent")} that the mail looks exactly right: From name, text, signature, footer.</>,
                )}</p>
              </StepRow>

              <StepRow n={7} title={t("Sab theek lage to LIVE mode on karo", "Turn on LIVE mode when all looks good")} href="/#mode" cta={t("Mode pe jao", "Go to mode")}>
                <p>{t(
                  <>{M("/")} → <b>Sending mode</b> → <B v="primary" icon="zap">LIVE karo</B> → dobara dabao. Ab approve ki hui mails asli leads ko jaati hain. Dashboard ka Setup guide har poore step pe hara tick lagata hai.</>,
                  <>{M("/")} → <b>Sending mode</b> → <B v="primary" icon="zap">Go LIVE</B> → press again. From now on, approved mails go to the real leads. The Setup guide on the Dashboard ticks off every finished step.</>,
                )}</p>
              </StepRow>
            </ol>
          </Section>

          {/* ---------------- 4. daily routine ---------------- */}
          <Section id="daily" icon="calendar" title={t("Roz ka kaam (LIVE ke baad)", "Daily routine (after going LIVE)")}
            sub={t("Roz ek baar, isi order mein", "Once a day, in this order")}>
            <ol className="space-y-4">
              <DayRow n={1} head={M("/")}>
                {t(
                  <><b>Aapka agla step</b> box batata hai abhi sabse zaroori kaam kya hai. <b>Dhyan dene wali baatein</b> mein laal ya peeli line ho to pehle wo theek karo.</>,
                  <><b>Your next step</b> tells you the most important thing to do now. If <b>Needs attention</b> shows a red or yellow line, fix that first.</>,
                )}
              </DayRow>
              <DayRow n={2} head={M("/review")}>
                {t(
                  <>Nayi mails padho: theek ho to <B v="success" icon="check">Approve karo</B>, chhoti galti ho to <B icon="pencil">Text edit karo</B>, pasand na aaye to <B icon="refresh">Naya version likho</B>, lead hi galat ho to <B v="reject" icon="x">Reject karo</B>.</>,
                  <>Read the new mails: <B v="success" icon="check">Approve</B> the good ones, <B icon="pencil">Edit text</B> for small mistakes, <B icon="refresh">Write a new version</B> if you don&apos;t like one, <B v="reject" icon="x">Reject</B> if the lead itself is wrong.</>,
                )}
              </DayRow>
              <DayRow n={3} head={M("/replies")}>
                {t("Leads ke jawab padho. Jawab apne mailbox (Hostinger webmail) se do: is app se reply nahi jaata.", "Read the leads' answers. Reply from your own mailbox (Hostinger webmail): this app does not send replies.")}
              </DayRow>
              <DayRow n={4} head={M("/sent")}>
                {t(
                  <>Dekho aaj kya gaya. Koi mail fail hui ho to use kholo aur <b>Server ka jawab</b> padho.</>,
                  <>See what went out today. If a mail failed, open it and read <b>Server reply</b>.</>,
                )}
              </DayRow>
              <DayRow n={5} head={M("/contacts")}>
                {t(
                  <><Badge v="needs_review" /> aur <Badge v="check_manual" /> chips pe click karke wo leads nipta do.</>,
                  <>Click the <Badge v="needs_review" /> and <Badge v="check_manual" /> chips and deal with those leads.</>,
                )}
              </DayRow>
              <DayRow n={6} head={t("Raat ki report mail", "Nightly report mail")}>
                {t(
                  "Jis din kuch hua ho, raat 23:00 IST ke baad Alert address pe din ki report aati hai: kitni mails gayi, kitne reply, opt-out aur bounce, aur kitni mails approval ke liye ruki hain.",
                  "On days with activity, a report arrives at your Alert address after 23:00 IST: how many mails went out, replies, opt-outs and bounces, and how many mails wait for approval.",
                )}
              </DayRow>
            </ol>
            <div className="mt-4">
              <Callout tone="danger" title={t("Emergency mein", "In an emergency")}>
                {t(
                  <>{M("/")} pe <B v="danger" icon="stop">Saari sending roko</B> dabao. Ek click mein sab ruk jaata hai.</>,
                  <>Press <B v="danger" icon="stop">Stop all sending</B> on {M("/")}. One click stops everything.</>,
                )}
              </Callout>
            </div>
          </Section>

          {/* ---------------- 5. parts of the screen ---------------- */}
          <Section id="screen" icon="grid" title={t("Screen ke hisse: upar ki bar, menu, (i) aur popup", "Parts of the screen: top bar, menus, (i) and pop-ups")}
            sub={t("Ye cheezein har page pe hoti hain", "These are on every page")}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Part title={t("Sidebar (computer pe)", "Sidebar (on a computer)")}
                visual={<>
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"><Icon name="panel-close" size={15} /></span>
                  <Icon name="arrow-right" size={12} className="text-slate-300" />
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"><Icon name="panel-open" size={15} /></span>
                </>}>
                {t(
                  "Left mein saare menu, 5 groups mein. Upar wala button sidebar ko chhota (sirf icons) ya wapas bada karta hai. Chhoti sidebar mein icon pe mouse le jao to naam dikhta hai. Neeche mode ka box aur Logout.",
                  "All menus on the left, in 5 groups. The button at the top collapses the sidebar to icons only, or opens it again. In the small sidebar, hover an icon to see its name. At the bottom: the mode box and Logout.",
                )}
              </Part>
              <Part title="Hinglish | English"
                visual={
                  <span className="inline-flex items-center gap-0.5 rounded-lg bg-slate-200/60 p-0.5">
                    <Icon name="globe" size={12} className="mx-1 text-slate-500" />
                    {["Hinglish", "English"].map((l, i) => (
                      <span key={l} className={`rounded-md px-2 py-0.5 text-2xs font-semibold ${(lang === "en") === (i === 1) ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{l}</span>
                    ))}
                  </span>
                }>
                {t(
                  "Upar ki bar mein (phone pe HI | EN). Click karte hi poora software us bhasha mein badal jaata hai, aur browser aapki choice yaad rakhta hai. Leads ko jaane wali mails pe iska koi asar nahi.",
                  "In the top bar (HI | EN on phones). One click switches the whole software to that language, and the browser remembers your choice. It has no effect on the mails leads get.",
                )}
              </Part>
              <Part title={t("Mode ka pill", "Mode pill")} visual={<><ModePill /><ModePill live /></>}>
                {t("Batata hai abhi DRY-RUN hai ya LIVE. Click karo to Dashboard ka Sending mode card khulta hai.", "Shows whether you are in DRY-RUN or LIVE. Click it to open the Sending mode card on the Dashboard.")}
              </Part>
              <Part title={t("‘N mails approve karni hain’ button", "‘N mails to approve’ button")}
                visual={<B><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{t("3 mails approve karni hain", "3 mails to approve")}</span></B>}>
                {t(
                  "Computer pe upar dikhta hai jab mails aapke approval ka wait kar rahi hon. Click = Approve page. Sidebar aur phone ke Approve tab pe bhi peela number dikhta hai.",
                  "Shows in the top bar on a computer when mails are waiting for your approval. Click = Approve page. The sidebar and the phone's Approve tab show an amber number too.",
                )}
              </Part>
              <Part title={t("Laal patti", "Red strip")}
                visual={
                  <span className="flex w-full min-w-0 items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1.5 text-2xs font-semibold text-white">
                    <Icon name="alert" size={12} /><span className="min-w-0">{t("Sending apne aap ruk gayi (auto-pause)", "Sending was paused automatically")}</span>
                  </span>
                }>
                {t(
                  "Har page ke upar dikhti hai jab sending ruki ho (STOP dabaya ya auto-pause hua). Click karke Dashboard pe wajah padho aur theek karo.",
                  "Shows at the top of every page when sending is stopped (STOP pressed or auto-pause). Click it to read the reason on the Dashboard and fix it.",
                )}
              </Part>
              <Part title={t("Phone pe neeche ki tab bar", "Phone tab bar")}
                visual={
                  <span className="grid w-full max-w-[260px] grid-cols-5 rounded-lg bg-white py-1 ring-1 ring-slate-200">
                    {MOBILE_TABS.map((href, i) => (
                      <span key={href} className={`flex min-w-0 flex-col items-center gap-0.5 text-[9.5px] font-medium ${i === 0 ? "text-indigo-600" : "text-slate-500"}`}>
                        <Icon name={m(href).icon} size={14} /><span className="max-w-full truncate">{m(href).short}</span>
                      </span>
                    ))}
                    <span className="flex min-w-0 flex-col items-center gap-0.5 text-[9.5px] font-medium text-slate-500"><Icon name="grid" size={14} />{t("Aur", "More")}</span>
                  </span>
                }>
                {t(
                  "Phone pe neeche 5 tab. ‘Aur’ dabao to saare menu unki chhoti jaankari ke saath khulte hain.",
                  "Five tabs at the bottom on phones. Tap ‘More’ to see every menu with a short description.",
                )}
              </Part>
              <Part title={t("(i) button", "(i) button")}
                visual={<span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">Sending mode<Icon name="info" size={14} className="text-slate-400" /></span>}>
                {t(
                  "Kisi bhi (i) pe mouse le jao ya tap karo: us cheez ki aasaan jaankari khulti hai. Click karne se khuli rehti hai.",
                  "Hover or tap any (i) to see a simple explanation of that item. Click it to keep it open.",
                )}
              </Part>
              <Part title={t("Popup message (toast)", "Pop-up message (toast)")}
                visual={<>
                  <ToastPic kind="success" title={t("Ho gaya", "Done")} />
                  <ToastPic kind="error" title={t("Problem aa gayi", "Something went wrong")} />
                  <ToastPic kind="warning" title={t("Dhyan do", "Please note")} />
                </>}>
                {t(
                  "Button dabane ke baad chhota popup aata hai (computer pe neeche right, phone pe upar). Hara = kaam ho gaya, laal = problem (wajah likhi hoti hai), peela = aadha hua ya dhyan do. Kai popup mein ‘Dekho’ link bhi hota hai.",
                  "After you press a button, a small pop-up appears (bottom right on a computer, at the top on phones). Green = done, red = problem (the reason is written in it), amber = partly done or please note. Many pop-ups also have an ‘Open’ link.",
                )}
              </Part>
              <Part title={t("‘Aage kya karna hai?’ box", "‘What to do next?’ box")}
                visual={
                  <span className="inline-flex items-center gap-2 rounded-lg border border-indigo-200/70 bg-gradient-to-r from-indigo-50 to-white px-2 py-1">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-600 text-white"><Icon name="arrow-right" size={11} strokeWidth={2.2} /></span>
                    <span className="text-2xs font-bold uppercase tracking-wider text-indigo-600">{t("Aage kya karna hai?", "What to do next?")}</span>
                  </span>
                }>
                {t(
                  "Har page pe ye box batata hai ki ab kya karna hai, aur button se seedha wahan le jaata hai. Dashboard pe iska naam ‘Aapka agla step’ hai.",
                  "On every page this box tells you what to do now, and its button takes you straight there. On the Dashboard it is called ‘Your next step’.",
                )}
              </Part>
              <Part title={t("Do baar dabane wale buttons", "Buttons that ask twice")}
                visual={<><B v="reject" icon="x">{t("Reject karo", "Reject")}</B><Icon name="arrow-right" size={12} className="text-slate-300" /><B v="armed" icon="alert">{t("Dobara dabao…", "Click again…")}</B></>}>
                {t(
                  "LIVE karo, Reject, campaign Start aur Sab approve karo jaise bade buttons pehli baar mein peele ho jaate hain. 5 second mein dobara dabao, tabhi kaam hota hai. Galti se dab gaya? Kuch mat karo, button apne aap normal ho jaata hai.",
                  "Big buttons like Go LIVE, Reject, campaign Start and Approve all turn amber on the first press. The action only happens if you press again within 5 seconds. Pressed by mistake? Do nothing; the button goes back to normal by itself.",
                )}
              </Part>
              <Part title="Logout" visual={<span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500"><Icon name="logout" size={14} />Logout</span>}>
                {t(
                  "Sidebar ke neeche (phone pe ‘Aur’ menu ke neeche). Logout se sending nahi rukti: worker server pe chalta rehta hai.",
                  "At the bottom of the sidebar (at the bottom of the ‘More’ menu on phones). Logging out does not stop sending: the worker keeps running on the server.",
                )}
              </Part>
            </div>
          </Section>

          {/* ---------------- 6. every menu ---------------- */}
          <Section flush id="menus" icon="list" title={t("Har menu ka kaam", "Every menu explained")}
            sub={t("Menu pe click karke kholo: uske andar ka har section aur button", "Click a menu to open it: every section and button inside it")}>
            <div>
              <MenuRow href="/" lang={lang} t={t}
                line={t("Control room: aaj kya hua, agla step kya hai, koi problem to nahi", "Control room: what happened today, what's next, anything wrong")}
                when={t("Roz sabse pehle.", "First thing every day.")}>
                <div>
                  <Sub icon="zap">Buttons</Sub>
                  <Defs items={[
                    { k: <B v="danger" icon="stop">{t("Saari sending roko", "Stop all sending")}</B>, d: t("Emergency button. Ek click mein saari sending band, aur chal rahe saare campaigns Pause ho jaate hain.", "The emergency button. One click stops all sending, and every running campaign is paused.") },
                    { k: <B icon="check-circle">{t("Stop / alert hatao", "Clear stop / alert")}</B>, d: t("Stop ya auto-pause ke baad dikhta hai. Pehle problem theek karo, phir do baar dabao. Uske baad har campaign ko uske page pe Resume karna hota hai.", "Appears after a stop or auto-pause. Fix the problem first, then press it twice. After that, resume each campaign on its own page.") },
                    { k: <><B v="primary" icon="zap">{t("LIVE karo", "Go LIVE")}</B> <B icon="flask">{t("Wapas DRY-RUN karo", "Back to DRY-RUN")}</B></>, d: t("Sending mode card mein. LIVE ke liye do baar dabana hota hai.", "In the Sending mode card. Going LIVE takes two presses.") },
                  ]} />
                </div>
                <div>
                  <Sub icon="dashboard">{t("Is page pe", "On this page")}</Sub>
                  <Defs items={[
                    { k: t("Laal box: Sending apne aap ruk gayi (auto-pause)", "Red box: Sending was paused automatically"), d: t("App ne khud sending rok di: jaise SMTP login, limit ya policy error, ek din mein 2 hard bounce, ya last 50 mails mein 5% se zyada bounce. Wajah box mein likhi hoti hai.", "The app stopped sending by itself: e.g. an SMTP login, limit or policy error, 2 hard bounces in one day, or more than 5% bounces in the last 50 mails. The reason is written in the box.") },
                    { k: t("Aapka agla step", "Your next step"), d: t("Abhi ka sabse zaroori ek kaam, seedhe button ke saath.", "The single most important thing to do now, with a button to it.") },
                    { k: "Setup guide", d: t("Pehli baar ke 7 kaam. Hara tick = ho gaya. Saare 7 ho jaane pe ye chhota ho jaata hai (kholke dobara dekh sakte ho).", "The 7 first-time steps. A green tick = done. Once all 7 are done it folds away (open it to see them again).") },
                    { k: "Sending mode", d: t("Abhi DRY-RUN hai ya LIVE, mails kahan jaa rahi hain, aur badalne ka button.", "Whether you are in DRY-RUN or LIVE, where mails go, and the button to switch.") },
                    {
                      k: t("Aaj ka hisaab", "Today's numbers"),
                      d: t(
                        <><b>Leads ko gayi</b> (aaj asli leads ko), <b>Approval baaki</b>, <b>Bheji / limit</b> (aaj kitni / aaj ki limit), <b>Agli mail kab</b>, <b>Queue</b> (chal rahe campaigns mein baaki leads) aur <b>Health</b> (hara / peela / laal). Tile pe click karke uska page kholo.</>,
                        <><b>Sent to leads</b> (to real leads today), <b>To approve</b>, <b>Sent / limit</b> (today&apos;s count / today&apos;s limit), <b>Next mail</b>, <b>Queue</b> (leads left in running campaigns) and <b>Health</b> (green / yellow / red). Click a tile to open its page.</>,
                      ),
                    },
                    { k: t("Dhyan dene wali baatein", "Needs attention"), d: t("Problems ki list, sabse zaroori upar. Laal = zaroori, peela = dhyan do, neela = aapka kaam baaki. Line pe click = seedha wo page jahan ye theek hota hai.", "The list of problems, most urgent first. Red = urgent, yellow = needs attention, blue = a task waiting for you. Click a line to go straight to where it gets fixed.") },
                    { k: t("Ab tak ka total", "All-time totals"), d: t("Shuru se ab tak: Total bheji, Reply aaye, Bounce, Opt-out aur Ledger.", "Since the start: Total sent, Replies, Bounced, Opted out and Ledger.") },
                    { k: "Active campaigns", d: t("Chal rahe, ruke hue aur draft campaigns: progress, baaki leads aur andaza kab tak khatam.", "Running, paused and draft campaigns: progress, leads left and the estimated finish.") },
                  ]} />
                </div>
              </MenuRow>

              <MenuRow href="/help" lang={lang} t={t}
                line={t("Ye guide", "This guide")}
                when={t("Jab bhi kuch samajh na aaye.", "Whenever something is unclear.")}>
                <p className="text-sm leading-relaxed text-slate-600">
                  {t("Upar ki list se kisi bhi topic pe jao. Har page ke (i) mein bhi us page ki chhoti jaankari hoti hai.", "Jump to any topic from the list at the top. The (i) icons on each page also explain that page briefly.")}
                </p>
              </MenuRow>

              <MenuRow href="/import" lang={lang} t={t}
                line={t("Leads ki list app mein lao: CSV, Excel, PDF, text, ya ek-ek lead", "Bring leads into the app: CSV, Excel, PDF, text, or one lead at a time")}
                when={t("Jab nayi leads mili hon. Pehli baar se pehle Ledger mein Sent folder import kar lo.", "Whenever you have new leads. Before the first time, import your Sent folder into the Ledger.")}>
                <div>
                  <Sub icon="upload">{t("Import page", "Import page")}</Sub>
                  <Defs items={[
                    {
                      k: t("List ki jaankari", "List details"),
                      d: t(
                        <><b>List ka naam</b>: sirf aapki pehchaan ke liye. <b>Ye addresses kahan se mile? *</b>: zaroori; har mail ke footer mein sach likha jaata hai, jaise ‘I found your address on Google Maps.’</>,
                        <><b>List name</b>: only for you to recognise it. <b>Where did you find these addresses? *</b>: required; it is written truthfully in every mail&apos;s footer, e.g. ‘I found your address on Google Maps.’</>,
                      ),
                    },
                    {
                      k: t("File upload karo ya text paste karo", "Upload a file or paste text"),
                      d: t(
                        <>CSV, TSV, XLSX, XLS, PDF ya TXT file chuno (ya kheench ke chhodo), ya emails wala koi bhi text paste karo. Phir <B v="primary" icon="file-up">File / text padho</B>: ye sirf padhta hai, kuch save nahi karta.</>,
                        <>Choose a CSV, TSV, XLSX, XLS, PDF or TXT file (or drag it in), or paste any text with emails. Then <B v="primary" icon="file-up">Read file / text</B>: it only reads, nothing is saved.</>,
                      ),
                    },
                    {
                      k: t("Columns match karo", "Map columns"),
                      d: t(
                        "Har field (Email *, Business ka naam, Contact ka naam, Website, Shehar, Desh, Business ka type, Business kya karta hai, Ek sach baat, Phone, Chain hai?) ke saamne apni file ka column chuno. App column ke naam dekh ke khud andaza lagata hai; galat ho to badlo. Sirf Email zaroori hai. Neeche pehli 5 rows ka preview dikhta hai.",
                        "For each field (Email *, Business name, Contact name, Website, City, Country, Type of business, What they do, One true fact, Phone, Chain flag), choose the matching column of your file. The app guesses from the column names; change anything that is wrong. Only Email is required. The first 5 rows are previewed below.",
                      ),
                    },
                    {
                      k: <B v="primary" icon="eye">{t("Check karke preview dekho", "Check & preview")}</B>,
                      d: t(
                        "Har address check hota hai: MX record (domain mail le sakta hai ya nahi), role address (jobs@, privacy@…), chain, duplicate business, Ledger aur Block list. Badi file mein 1-2 minute lagte hain.",
                        "Every address is checked: MX record (can the domain receive mail), role address (jobs@, privacy@…), chain, duplicate business, Ledger and Block list. A big file takes 1-2 minutes.",
                      ),
                    },
                    {
                      k: t("Ek lead add karo", "Add a single lead"),
                      d: t(
                        <>Sirf ek address ho to ye form bharo: email (zaroori) aur jo pata ho (business, contact, website, shehar, desh, type, kya karte hain, sach baat), saath mein <b>Ye address kahan se mila? *</b>. Phir <B v="primary" icon="eye">Check karke preview dekho</B>: file jaise hi checks aur preview, phir confirm.</>,
                        <>For just one address, fill in this form: the email (required) and whatever you know (business, contact, website, city, country, type, what they do, a true fact), plus <b>Where did you find this address? *</b>. Then <B v="primary" icon="eye">Check &amp; preview</B>: the same checks and preview as for a file, then confirm.</>,
                      ),
                    },
                    { k: t("CSV mein kya do", "What to put in the CSV"), d: t("Har column ka matlab aur example, Import page pe hi (isi guide ke CSV wale hisse jaisa).", "What each column means, with an example, right on the Import page (like the CSV part of this guide).") },
                    { k: <B icon="download">{t("Sample CSV download karo", "Download sample CSV")}</B>, d: t("Example rows wali CSV file. Example rows hata ke apni rows daalo, phir upload karo.", "A CSV file with example rows. Replace the example rows with your own, then upload it.") },
                  ]} />
                </div>
                <div>
                  <Sub icon="eye">{t("Preview page (har row ka result)", "Preview page (result for each row)")}</Sub>
                  <Defs items={[
                    { k: <Badge v="send" />, d: t("Saare checks pass. Confirm karne par Ready ban ke campaign mein use hote hain.", "Passed every check. On confirm they become Ready and can be used in a campaign.") },
                    { k: <Badge v="needs_review" />, d: t("Kisi insaan ka personal address lagta hai (jaise naam.surname@ ya gmail). Confirm ke baad Contacts mein khud approve ya reject karo.", "Looks like a person's private address (like name.surname@ or gmail). After confirming, approve or reject it yourself in Contacts.") },
                    { k: <Badge v="skip" />, d: t("Add nahi hoga. ‘Wajah’ column mein likha hai kyun (galat email, MX nahi, pehle contact hua…).", "Not added. The ‘Reason’ column says why (invalid email, no MX, already contacted…).") },
                    { k: t("Tiles aur tabs", "Tiles and tabs"), d: t("Sab / Bhejenge / Review / Skip se rows filter karo.", "Filter the rows with All / Will send / Review / Skip.") },
                    { k: <B v="primary" icon="check">{t("Import confirm karo", "Confirm import")}</B>, d: t("Tabhi leads Contacts mein add hote hain. Skip wale kabhi add nahi hote.", "Only now are the leads added to Contacts. Skipped rows are never added.") },
                  ]} />
                </div>
              </MenuRow>

              <MenuRow href="/campaigns" lang={lang} t={t}
                line={t("List se campaign banao, 5 samples padho, start ya pause karo", "Create a campaign from a list, read 5 samples, start or pause it")}
                when={t("Har nayi list ke liye ek campaign. Chalte campaign ka haal dekhne ke liye bhi.", "One campaign for each new list. Also to check how a running campaign is doing.")}>
                <div>
                  <Sub icon="plus">{t("Naya campaign banao (form)", "Create a new campaign (form)")}</Sub>
                  <Defs items={[
                    { k: t("Campaign ka naam", "Campaign name"), d: t("Sirf aapke liye. Lead ko kabhi nahi dikhta.", "Only for you. Leads never see it.") },
                    { k: "List", d: t("Kis list ke leads ko mail jayegi. Bracket mein free leads ki ginti aur kitne review baaki hain.", "Which list's leads get the mails. The brackets show the free leads and how many still need review.") },
                    { k: t("Bhasha (desh se apne aap)", "Language (auto from country)"), d: t("Mail is bhasha mein banti hai. Leads ke desh se apne aap chuni jaati hai; chaho to badlo.", "Mails are written in this language. It is picked from the leads' country; you can change it.") },
                    { k: t("Timezone (sending window isi mein chalegi)", "Timezone (used for the sending window)"), d: t("Sending window aur daily limit isi timezone se chalti hai, taaki mail lead ke office time mein pahunche.", "The sending window and the daily limit follow this timezone, so mails arrive during the lead's office hours.") },
                    {
                      k: t("Mail kaise banegi", "How mails are written"),
                      d: t(
                        <><b>AI har lead ke liye likhega</b> = har mail alag, CSV ki details se. <b>Template 1/2/3</b> (naam ke saath, jaise ‘Template 1: Website intro’) = Settings ka fixed text, sirf naam, city jaisi cheezein bharti hain. <a href="#ai-template" className="link">Kab kya chunein?</a></>,
                        <><b>AI writes each mail</b> = a different mail for each lead, from its CSV details. <b>Template 1/2/3</b> (with its name, e.g. ‘Template 1: Website intro’) = the fixed text from Settings, with only things like name and city filled in. <a href="#ai-template" className="link">Which to choose?</a></>,
                      ),
                    },
                    { k: <B v="primary" icon="plus">{t("Campaign banao", "Create campaign")}</B>, d: t("Campaign ban jaata hai aur list ke free leads jud jaate hain. Abhi koi mail nahi jaati.", "Creates the campaign and adds the list's free leads. No mail goes out yet.") },
                  ]} />
                </div>
                <div>
                  <Sub icon="megaphone">{t("Saare campaigns (table)", "All campaigns (table)")}</Sub>
                  <p className="text-sm leading-relaxed text-slate-600">
                    {t(
                      "Har campaign ka status, list, bhasha / timezone, Bheji, Baaki aur Kab tak khatam; naam ke neeche AI ya Template. Naam pe click karke campaign ka page kholo. Status:",
                      "Each campaign's status, list, language / timezone, Sent, Remaining and Est. finish; under the name, AI or Template. Click a name to open the campaign page. Status:",
                    )}{" "}
                    <span className="inline-flex flex-wrap gap-1 align-middle"><Badge v="draft" /><Badge v="running" /><Badge v="paused" /><Badge v="done" /></span>
                  </p>
                </div>
                <div>
                  <Sub icon="sliders">{t("Campaign ka page", "The campaign page")}</Sub>
                  <Defs items={[
                    { k: t("Naam ke neeche", "Under the name"), d: t("Status, bhasha, list, aur mail kaise banti hai: AI ya ‘Template 1: …’.", "Status, language, list, and how mails are written: AI or ‘Template 1: …’.") },
                    { k: t("Upar ke steps", "Steps on top"), d: t("5 sample drafts banao → Padho aur start karo → Har mail approve karo → Bheji mails dekho. Neela step = aap abhi yahan ho.", "Make 5 sample drafts → Read and start → Approve every mail → See sent mails. The blue step = where you are now.") },
                    { k: <B icon="bot">{t("5 sample drafts banao", "Make 5 sample drafts")}</B>, d: t("List ke pehle 5 leads ki mail banti hai (AI ya template se). Kuch na bane to dobara dabao: sirf bache hue bante hain.", "Mails are made for the first 5 leads of the list (by the AI or the template). If some fail, press it again: only the missing ones are made.") },
                    { k: <B v="primary" icon="play">{t("Samples theek hain: approve karke start karo", "Samples look good: approve and start")}</B>, d: t("Do baar dabao. Paanchon samples approve ho jaate hain aur campaign chalu. SPF ya DKIM missing ho to start nahi hota.", "Press twice. The five samples are approved and the campaign starts. It does not start if SPF or DKIM is missing.") },
                    { k: <><B icon="pause">{t("Pause karo", "Pause")}</B> <B v="primary" icon="play">{t("Resume karo", "Resume")}</B></>, d: t("Campaign rokna, aur baad mein wahin se aage chalana.", "Pause the campaign, and later carry on from where it stopped.") },
                    { k: t("Chaar tiles", "Four tiles"), d: t("Baaki (Ready leads), Bheji gayi (reply, bounce, opt-out ke saath), Kab tak khatam (andaza) aur Bhasha / List (‘Kahan se mile’ ke saath).", "Remaining (Ready leads), Sent (with replies, bounces, opt-outs), Estimated finish and Language / List (with ‘Source’).") },
                    {
                      k: <><B icon="refresh">{t("Naya version likho", "Write a new version")}</B> <B icon="refresh">{t("Template se dobara banao", "Rebuild from template")}</B></>,
                      d: t(
                        "Kisi draft pe. AI campaign: purani hata ke nayi mail likhwao. Template campaign: Settings mein template badalne ke baad mail ko naye text se dobara bharo.",
                        "On a draft. AI campaign: throw it away and get a new mail written. Template campaign: after you change the template in Settings, refill the mail with the new text.",
                      ),
                    },
                    { k: t("Peele aur laal box", "Amber and red boxes"), d: t("‘Kuch drafts retry ke liye ruke hain’ = kuch leads ki mail nahi ban payi; app thodi der mein khud dobara try karta hai. Laal ‘status pakka nahi’ box = Manual check, Contacts mein dekho.", "‘Some drafts are waiting for a retry’ = some mails could not be made; the app retries by itself shortly. A red ‘uncertain status’ box = Manual check; see Contacts.") },
                  ]} />
                </div>
              </MenuRow>

              <MenuRow href="/review" lang={lang} t={t}
                line={t("Har mail jaane se pehle yahan padho aur approve karo", "Read and approve every mail here before it goes out")}
                when={t("Roz, aur jab bhi upar ‘N mails approve karni hain’ dikhe.", "Every day, and whenever ‘N mails to approve’ shows at the top.")}>
                <div>
                  <Sub icon="mail">{t("Har card mein", "In each card")}</Sub>
                  <Defs items={[
                    { k: t("Upar ka box", "Box at the top"), d: t("DRY-RUN: approve ki hui mail sirf test address pe jayegi. LIVE: asli lead ko. Auto-approve on ho to peeli warning dikhti hai.", "DRY-RUN: an approved mail goes only to the test address. LIVE: to the real lead. With auto-approve on, an amber warning shows.") },
                    { k: t("Lead ki line", "Lead line"), d: t("Business ka naam (click = contact ki poori history), bhasha, email, website aur campaign.", "Business name (click = the contact's full history), language, email, website and campaign.") },
                    {
                      k: t("‘AI ko ye pata tha’", "‘What the AI knew’"),
                      d: t(
                        "Mail likhte waqt AI ko is lead ke baare mein bas yahi baatein di gayi thi: CSV ki details aur business ki apni website ka title / description. Mail mein inse bahar ki koi baat ho to Edit ya Reject karo. Template wali mail pe iski jagah ‘Template se bani: …’ likha hota hai.",
                        "The only points the AI was given about this lead when it wrote the mail: the CSV details and the title / description of the business's own website. If the mail says anything beyond these, Edit or Reject it. A template mail shows ‘Written from template: …’ instead.",
                      ),
                    },
                    { k: t("Mail (jaisi jayegi)", "Mail (as it will be sent)"), d: t("Bilkul wahi mail jo lead ko jayegi: subject, text, signature aur footer.", "Exactly the mail the lead will get: subject, text, signature and footer.") },
                    { k: "English translation", d: t("Sirf aapke padhne ke liye. Lead ko ye nahi jaata.", "Only for you to read. The lead does not get it.") },
                  ]} />
                </div>
                <div>
                  <Sub icon="zap">Buttons</Sub>
                  <Defs items={[
                    { k: <B v="success" icon="check">{t("Approve karo", "Approve")}</B>, d: t("Mail sending window mein jayegi (jab uska campaign chal raha ho).", "The mail goes out in the sending window (while its campaign is running).") },
                    { k: <B icon="pencil">{t("Text edit karo", "Edit text")}</B>, d: t("Subject aur text khud badlo. Niyam: 60–110 words, aakhir mein ek sawaal (?), koi link nahi, ALL CAPS nahi, ‘!!’ nahi, bhasha wahi. Save ke baad dobara approve karna hota hai.", "Change the subject and text yourself. Rules: 60–110 words, end with a question (?), no links, no ALL CAPS, no ‘!!’, same language. After saving, approve it again.") },
                    { k: <B icon="refresh">{t("Naya version likho", "Write a new version")}</B>, d: t("AI ye mail dobara likhta hai.", "The AI writes this mail again.") },
                    { k: <B v="reject" icon="x">{t("Reject karo", "Reject")}</B>, d: t("Do baar dabao. Is lead ko kabhi mail nahi jayegi.", "Press twice. This lead will never be emailed.") },
                    { k: <B icon="check-check">{t("Sab N approve karo", "Approve all N")}</B>, d: t("Page ki saari mails ek saath approve (do baar dabao). Sirf tab jab sab padh li hon.", "Approves every mail on the page at once (press twice). Only when you have read them all.") },
                    { k: t("Peela box: ‘Campaign abhi start nahi hua’", "Amber box: ‘The campaign has not started yet’"), d: t("Approve karne ke baad bhi mail tabhi jayegi jab campaign chalega. Campaign page pe start ya Resume karo.", "Even after approval, the mail goes out only once the campaign runs. Start or resume it on the campaign page.") },
                  ]} />
                </div>
              </MenuRow>

              <MenuRow href="/sent" lang={lang} t={t}
                line={t("Din ke hisaab se: kaunsi mail kab, kisko, kis text ke saath gayi", "Day by day: which mail went out when, to whom, with what text")}
                when={t("Roz, aur jab bhi check karna ho ki koi mail gayi ya nahi.", "Daily, and whenever you want to check whether a mail went out.")}>
                <Defs items={[
                  { k: t("Din badlo", "Change the day"), d: t(<>‹ › se pichhla / agla din. <B>Aaj pe jao</B> se wapas aaj pe. Saare samay IST mein.</>, <>‹ › for the previous / next day. <B>Today</B> jumps back to today. All times are in IST.</>) },
                  { k: t("Upar ke 3 numbers", "The 3 numbers on top"), d: t("Leads ko gayi (live), Dry-run (aapke test address pe), aur Fail / result pakka nahi.", "Sent to leads (live), Dry-run (to your test address), and Failed / uncertain.") },
                  { k: t("Live / Dry-run / Sab", "Live / Dry-run / All"), d: t("Live = asli leads ko gayi mails. Dry-run = sirf aapke test address pe. Sab = dono, fail hui mails samet.", "Live = mails sent to real leads. Dry-run = only to your test address. All = both, including failed mails.") },
                  { k: t("Kisi mail pe click", "Click a mail"), d: t("Bilkul wahi text jo gaya (logo ke saath tha ya nahi), kisko gayi, samay, aur Server ka jawab (250 se shuru = server ne mail le li). Neeche ‘Contact ki history’ link.", "The exact text that went out (and whether the logo was in it), to whom, the time, and the Server reply (starts with 250 = the server accepted it). Below it: the ‘Contact history’ link.") },
                  { k: t("Laal box (fail)", "Red box (failed)"), d: t("4xx wali mail agle sending din apne aap dobara try hoti hai. Timeout (result pakka nahi) wali lead Contacts › Manual check mein jaati hai: use khud dobara mat bhejo.", "A mail refused with a 4xx code is retried automatically on the next sending day. A lead with a timeout (uncertain result) goes to Contacts › Manual check: do not mail it again yourself.") },
                ]} />
              </MenuRow>

              <MenuRow href="/contacts" lang={lang} t={t}
                line={t("Saare leads ek jagah: search, filter, review aur poori history", "All leads in one place: search, filter, review and full history")}
                when={t("‘Review chahiye’ aur ‘Manual check’ wale leads nipatane ke liye, ya kisi lead ki history dekhne ke liye.", "To deal with ‘Needs review’ and ‘Manual check’ leads, or to see a lead's history.")}>
                <div>
                  <Sub icon="users">{t("List page", "List page")}</Sub>
                  <Defs items={[
                    { k: t("Search box", "Search box"), d: t("Email, business ka naam ya website se dhoondo.", "Find by email, business name or website.") },
                    { k: <><B>{t("Sab status", "All statuses")}</B> <B v="primary" icon="filter">{t("Filter karo", "Filter")}</B> <B icon="x">{t("Saaf karo", "Clear")}</B></>, d: t("Status chuno aur Filter dabao. Saaf karo se saare filter hat jaate hain.", "Pick a status and press Filter. Clear removes all filters.") },
                    { k: "Chips", d: t("Ek click mein filter: Sab, Review chahiye, Manual check, Ready, Sent, Reply aaya.", "One-click filters: All, Needs review, Manual check, Ready, Sent, Replied.") },
                    { k: <B icon="download">{t("CSV export karo", "Export CSV")}</B>, d: t("Abhi wale filter ke contacts ki CSV file download hoti hai.", "Downloads a CSV of the contacts in the current filter.") },
                    { k: <><B v="success" icon="check">Approve</B> <B icon="x">Reject</B></>, d: t("‘Review chahiye’ wali rows pe. Approve = campaign mein jayega; Reject (do baar) = kabhi mail nahi.", "On ‘Needs review’ rows. Approve = it joins the campaign; Reject (press twice) = never mailed.") },
                    { k: t(<><B>Peeche</B> <B>Aage</B></>, <><B>Previous</B> <B>Next</B></>), d: t("Ek page pe 100 contacts; baaki agle page pe.", "100 contacts per page; the rest on the next page.") },
                  ]} />
                </div>
                <div>
                  <Sub icon="list">{t("Har status ka matlab", "What each status means")}</Sub>
                  <Defs items={[
                    { k: <Badge v="ready" />, d: t("Mail ke liye taiyaar.", "Ready for a mail.") },
                    { k: <Badge v="needs_review" />, d: t("Personal address lagta hai; aap approve ya reject karoge.", "Looks like a personal address; you approve or reject it.") },
                    { k: <Badge v="sent" />, d: t("Mail chali gayi.", "The mail went out.") },
                    { k: <Badge v="replied" />, d: t("Lead ne jawab diya.", "The lead replied.") },
                    { k: <Badge v="bounced" />, d: t("Mail wapas aayi (galat ya band address). Block List mein chala gaya.", "The mail came back (wrong or closed address). Added to the Block list.") },
                    { k: <Badge v="opted_out" />, d: t("Lead ne mana kiya. Block List mein chala gaya.", "The lead said no. Added to the Block list.") },
                    { k: <Badge v="check_manual" />, d: t("Pata nahi mail gayi ya nahi. Sent folder dekh ke mark karo.", "Unclear whether the mail went out. Check the Sent folder and mark it.") },
                    { k: <Badge v="failed" />, d: t("Mail nahi ja payi. Apne aap dobara nahi jaati.", "The mail could not be sent. It is not resent automatically.") },
                    { k: <Badge v="suppressed" />, d: t("Block List mein hai; mail nahi jayegi.", "On the Block list; no mail.") },
                    { k: <Badge v="rejected" />, d: t("Aapne reject kiya; kabhi mail nahi.", "You rejected it; never mailed.") },
                    { k: <Badge v="already_contacted" />, d: t("Pehle se Ledger mein tha; dobara cold mail nahi.", "Already in the Ledger; no second cold mail.") },
                  ]} />
                </div>
                <div>
                  <Sub icon="user">{t("Contact ka page (email pe click)", "Contact page (click an email)")}</Sub>
                  <Defs items={[
                    { k: t("Jaankari", "Details"), d: t("Business, email, website, phone, desh, list (‘Kahan se mile’ ke saath), campaign, aur Ledger mein hai ya nahi.", "Business, email, website, phone, country, list (with ‘Source’), campaign, and whether it is in the Ledger.") },
                    { k: t("AI ko kya pata hai", "What the AI knows"), d: t("Is lead ke baare mein AI ko bas yahi milta hai: contact, shehar, type, kya karte hain, sach baat aur website ka title / description. Kuch na ho to mail general rehti hai.", "All the AI gets about this lead: contact, city, type, what they do, a true fact and the website's title / description. If nothing is there, the mail stays general.") },
                    { k: "Mail", d: t("Lead ke liye bani mail, English translation aur approval ka status.", "The mail written for the lead, its English translation and the approval status.") },
                    { k: t("Aaye hue jawab", "Replies received"), d: t("Is lead se aaye reply, opt-out, bounce ya auto-reply.", "Replies, opt-outs, bounces or auto-replies from this lead.") },
                    { k: "History", d: t("Har step: draft bana, approve hua, server ka jawab, reply… Problem ki wajah yahin milti hai.", "Every step: draft created, approved, the server's reply, replies… The reason for a problem is found here.") },
                    { k: <><B icon="check">{t("Haan, mail gayi thi", "Yes, it was sent")}</B> <B icon="x">{t("Nahi gayi (band karo)", "No, not sent (close)")}</B></>, d: t("Sirf Manual check pe. Pehle Hostinger webmail ke Sent folder mein lead ka email dhoondo, phir sahi button do baar dabao. Mail apne aap kabhi dobara nahi jaati.", "Only for Manual check. First search for the lead's email in the Sent folder of Hostinger webmail, then press the right button twice. The mail is never resent automatically.") },
                    { k: <><B v="success" icon="check">{t("Approve karo", "Approve")}</B> <B icon="x">{t("Reject karo", "Reject")}</B></>, d: t("Sirf ‘Review chahiye’ pe, upar ke peele box mein.", "Only for ‘Needs review’, in the amber box at the top.") },
                  ]} />
                </div>
              </MenuRow>

              <MenuRow href="/replies" lang={lang} t={t}
                line={t("Leads ke jawab, opt-out, bounce aur auto-reply", "Replies, opt-outs, bounces and auto-replies from leads")}
                when={t("Roz. Lead ka jawab aaya ho to jaldi reply karo.", "Daily. When a lead answers, reply soon.")}>
                <Defs items={[
                  { k: <><B icon="reply">{t("Reply & opt-out", "Replies & opt-outs")}</B> <B icon="inbox">{t("Sab dikhao", "Show all")}</B></>, d: t("Pehla tab: sirf asli jawab aur mana karne wali mails. Sab dikhao: bounce aur auto-reply bhi.", "First tab: only real replies and mails saying no. Show all: bounces and auto-replies too.") },
                  { k: <Badge v="reply" />, d: t("Lead ka asli jawab. Contact ka status ‘Reply aaya’ ho jaata hai.", "A real answer from the lead. The contact's status becomes ‘Replied’.") },
                  { k: <Badge v="optout" />, d: t("Lead ne mana kiya (jaise STOP). Apne aap Block List mein.", "The lead said no (e.g. STOP). Added to the Block list automatically.") },
                  { k: <><Badge v="bounce" /> <Badge v="softbounce" /></>, d: t("Mail nahi pahunchi. Bounce = address galat ya band (Block List mein); soft bounce = abhi ki problem (jaise inbox full).", "The mail did not arrive. Bounce = wrong or closed address (on the Block list); soft bounce = a temporary problem (e.g. a full inbox).") },
                  { k: <Badge v="auto" />, d: t("Apne aap aaya jawab, jaise out of office.", "An automatic answer, like out of office.") },
                  { k: t("Har card", "Each card"), d: t("Upar kisne aur kab; beech mein aapki bheji mail (click karke kholo); neeche unka jawab, aur doosri bhasha ho to English translation.", "Top: who and when; middle: the mail you sent (click to open); bottom: their reply, plus an English translation if it is in another language.") },
                  { k: "Sync", d: t("Inbox har 10 minute mein apne aap sync hota hai. Turant chahiye to Settings mein ‘Inbox abhi sync karo’.", "The inbox syncs automatically every 10 minutes. To check right away, use ‘Sync inbox now’ in Settings.") },
                ]} />
                <Callout tone="info">{t("Ye page sirf padhne ke liye hai. Reply apne mailbox (Hostinger webmail) se do.", "This page is read-only. Reply from your own mailbox (Hostinger webmail).")}</Callout>
              </MenuRow>

              <MenuRow href="/ledger" lang={lang} t={t}
                line={t("Jinhe kabhi bhi mail gayi, unki permanent list: dobara kabhi cold mail nahi", "Permanent list of everyone ever mailed: never cold-mailed again")}
                when={t("Pehli baar setup mein zaroor, aur jab bhi app ke bahar bahut mails bheji hon.", "Always during first setup, and whenever you have sent many mails outside the app.")}>
                <Defs items={[
                  {
                    k: t("Khud contact kiye address daalo", "Add already-contacted addresses"),
                    d: t(
                      <>Ek ya kai email (space, comma ya nayi line se alag), optional Note, phir <B v="primary" icon="plus">Ledger mein daalo</B>.</>,
                      <>One or many emails (separated by spaces, commas or new lines), an optional Note, then <B v="primary" icon="plus">Add to ledger</B>.</>,
                    ),
                  },
                  { k: <B v="primary" icon="download">{t("Sent folder import karo", "Import Sent folder")}</B>, d: t("Mailbox ke Sent folder ki har mail ke To, Cc, Bcc address Ledger mein. Aapka apna, test aur alert address chhod diye jaate hain. Dobara chalana safe hai.", "Every To, Cc and Bcc address from your mailbox's Sent folder goes into the Ledger. Your own, test and alert addresses are skipped. Safe to run again.") },
                  {
                    k: t("Check karo: kabhi contact hua?", "Check: was it ever contacted?"),
                    d: t(
                      <>Poora email daalo aur <B v="primary">Check karo</B>. Peela = haan, pehle contact hua (dobara kabhi nahi). Hara = nahi.</>,
                      <>Enter the full email and press <B v="primary">Check</B>. Amber = yes, contacted before (never again). Green = no.</>,
                    ),
                  },
                  { k: t("Ledger ke address", "Addresses in the ledger"), d: t("Sabse naye 300: Status, Source (App se bheji, Khud daala, Sent folder), Pehli baar, Note. Yahan se kabhi kuch delete nahi hota.", "The newest 300: Status, Source (Sent by the app, Added manually, Sent folder), First contacted, Note. Nothing is ever deleted here.") },
                ]} />
                <Callout tone="info">{t("Har send se pehle Ledger check hota hai: ek address aur ek business (same domain) ko hamesha ke liye sirf ek cold mail.", "The Ledger is checked before every send: one address and one business (same domain) get only one cold mail, ever.")}</Callout>
              </MenuRow>

              <MenuRow href="/suppression" lang={lang} t={t}
                line={t("Jinhe kabhi mail nahi bhejni: ek email ya poora domain", "Never mail these: single emails or whole domains")}
                when={t("Competitor, purane clients, apni company, ya koi jisne mana kiya ho.", "Competitors, old clients, your own company, or anyone who said no.")}>
                <Defs items={[
                  {
                    k: t("Email ya domain", "Email or domain"),
                    d: t(
                      <><Code>naam@company.com</Code> = sirf wo email. <Code>company.com</Code> = us domain ke saare address. Space, comma ya nayi line se kai ek saath.</>,
                      <><Code>name@company.com</Code> = only that email. <Code>company.com</Code> = every address on that domain. Add several at once, separated by spaces, commas or new lines.</>,
                    ),
                  },
                  { k: t("Wajah (optional)", "Reason (optional)"), d: t("Sirf aapki yaad ke liye. Khaali = ‘Khud daala’.", "Just a reminder for you. Empty = ‘Added manually’.") },
                  { k: <B v="primary" icon="ban">{t("Block list mein daalo", "Add to block list")}</B>, d: t("Turant block. Jo leads Ready ya Review chahiye mein hain, wo ‘Block list’ status mein chale jaate hain. Approve ho chuki mail bhi nahi jaati.", "Blocks at once. Leads that are Ready or Needs review move to the ‘Blocked’ status. Even an already approved mail does not go out.") },
                  { k: t("Apne aap", "Automatically"), d: t("Opt-out reply aur hard bounce wale address khud yahan aa jaate hain.", "Addresses that send an opt-out reply or hard bounce are added here by themselves.") },
                  { k: t("Neeche ki table", "The table below"), d: t("Email / domain, Type (Email ya Poora domain), Wajah, Kab add hua. Permanent: kuch delete nahi hota.", "Email / domain, Type (Email or Whole domain), Reason, Added. Permanent: nothing is deleted.") },
                ]} />
              </MenuRow>

              <MenuRow href="/logs" lang={lang} t={t}
                line={t("App, worker aur mail server ka record: kya hua, kab, koi error", "Record of the app, worker and mail server: what happened, when, any errors")}
                when={t("Jab koi mail fail ho, worker band lage, ya sending apne aap ruk jaaye.", "When a mail fails, the worker seems down, or sending stops by itself.")}>
                <Defs items={[
                  { k: <B icon="activity">App log</B>, d: t("App aur worker ka har kaam. Level: Info = normal, Warning = dhyan do, Error = kuch fail hua. Scope = app ka kaunsa hissa.", "Everything the app and worker did. Level: Info = normal, Warning = pay attention, Error = something failed. Scope = which part of the app.") },
                  { k: <B icon="x-circle">{t("Sirf errors", "Errors only")}</B>, d: t("Sirf Error wali entries. Message mein aksar wajah likhi hoti hai (jaise SMTP login fail).", "Only Error entries. The message usually names the cause (like a failed SMTP login).") },
                  { k: <B icon="server">{t("SMTP jawab", "SMTP responses")}</B>, d: t("Har bheji mail pe mail server ka asli jawab. 250 = mail le li, 4xx = abhi nahi (baad mein retry), 5xx = mana kar diya. Mode = Dry-run ya Live.", "The mail server's real reply to every mail sent. 250 = accepted, 4xx = not now (retried later), 5xx = refused. Mode = Dry-run or Live.") },
                ]} />
              </MenuRow>

              <MenuRow href="/settings" lang={lang} t={t}
                line={t("Mailbox, aapka naam aur signature, templates, sending rules, AI aur DNS", "Mailbox, your name and signature, templates, sending rules, AI and DNS")}
                when={t("Pehli baar setup mein, aur jab bhi mailbox, naam, offer ya rules badalne hon.", "During first setup, and whenever you change the mailbox, name, offer or rules.")}>
                <p className="text-sm leading-relaxed text-slate-600">
                  {t("Upar ke chhote buttons (Test, Mailbox, Profile, Offer, Templates…) seedha us hisse pe le jaate hain.", "The small buttons at the top (Test, Mailbox, Profile, Offer, Templates…) jump straight to that part.")}
                </p>
                <div>
                  <Sub icon="zap">Connection test</Sub>
                  <Defs items={[
                    { k: <B icon="server">SMTP test</B>, d: t("Mail bhejne ka login check.", "Checks the login for sending mail.") },
                    { k: <B icon="inbox">IMAP test</B>, d: t("Inbox padhne ka login check.", "Checks the login for reading the inbox.") },
                    { k: <B icon="mail">{t("Test mail mujhe bhejo", "Send test mail to me")}</B>, d: t("Ek asli sample mail aapke Test address pe.", "A real sample mail to your Test address.") },
                    { k: <B icon="bot">AI test</B>, d: t("AI key aur model check.", "Checks the AI key and model.") },
                    { k: <B icon="shield">{t("DNS check karo", "Check DNS")}</B>, d: t("SPF, DKIM aur DMARC records padhta hai.", "Reads the SPF, DKIM and DMARC records.") },
                    { k: <B icon="refresh">{t("Inbox abhi sync karo", "Sync inbox now")}</B>, d: t("Replies, bounce aur opt-out abhi laao (warna har 10 minute mein apne aap).", "Fetch replies, bounces and opt-outs now (otherwise every 10 minutes by itself).") },
                    { k: t("Neeche status", "Status below"), d: t("Mode, Server .env (SMTP_PASSWORD, AI_API_KEY: ‘set hai’ ya ‘missing’), DNS ka pichhla result aur pichhla inbox sync.", "Mode, Server .env (SMTP_PASSWORD, AI_API_KEY: ‘set’ or ‘missing’), the last DNS result and the last inbox sync.") },
                  ]} />
                </div>
                <div>
                  <Sub icon="mail">Mailbox (SMTP / IMAP)</Sub>
                  <Defs items={[
                    { k: "SMTP / IMAP", d: t("Host, Port, SSL/TLS aur user. Hostinger ki settings pehle se bhari hain (smtp.hostinger.com 465, imap.hostinger.com 993); aam taur pe kuch badalna nahi.", "Host, Port, SSL/TLS and user. Hostinger's settings are filled in already (smtp.hostinger.com 465, imap.hostinger.com 993); usually nothing to change.") },
                    { k: "From address", d: t("Isi address se leads ko mail jaati hai. Aapke apne domain ka hona chahiye.", "Mail to leads goes out from this address. It must be on your own domain.") },
                    { k: "Test address", d: t("Aapka personal email. DRY-RUN aur test mails yahan aati hain. LIVE ke liye bhi zaroori.", "Your personal email. DRY-RUN and test mails arrive here. Also required for LIVE.") },
                    { k: "Alert address", d: t("Auto-pause, reply aur raat ki report ki mail yahan. Khaali = Test address.", "Auto-pause, reply and nightly report mails go here. Empty = Test address.") },
                    { k: t("Password", "Passwords"), d: t("Yahan nahi daalte. Server ki .env file mein hote hain: SMTP_PASSWORD, IMAP_PASSWORD, AI_API_KEY.", "Not entered here. They live in the server's .env file: SMTP_PASSWORD, IMAP_PASSWORD, AI_API_KEY.") },
                  ]} />
                </div>
                <div>
                  <Sub icon="user">Sender profile (signature)</Sub>
                  <Defs items={[
                    { k: t("Naam, Role, Business, Website, Portfolio links", "Name, Role, Business, Website, Portfolio links"), d: t("Har mail ke neeche signature mein. Signature app khud lagata hai, AI nahi.", "They go into the signature under every mail. The app adds the signature itself, not the AI.") },
                    {
                      k: t("Inbox mein naam (From name)", "Name in the inbox (From name)"),
                      d: t(
                        <>Lead ke inbox aur phone notification mein dikhne wala naam, jaise <b>Brighton Solution</b>. Khaali chhodo to Business ka naam use hota hai (wo bhi khaali ho to aapka Naam).</>,
                        <>The name leads see in their inbox and phone notifications, e.g. <b>Brighton Solution</b>. Leave it empty to use the Business name (or your Name if that is empty too).</>,
                      ),
                    },
                    { k: "Postal address", d: t("Har mail ke footer mein. Cold email ke law ke hisaab se zaroori.", "In every mail's footer. Required by cold email law.") },
                    { k: t("Signature mein logo", "Logo in signature"), d: t("On = HTML mail, signature ke neeche chhota logo. Off = sirf plain text, naye domain ke liye sabse safe.", "On = HTML mail with a small logo under the signature. Off = plain text only, safest for a new domain.") },
                    { k: t("Signature preview dekho", "Show signature preview"), d: t("Save ki hui settings se har mail ka end kaisa dikhega.", "How the end of each mail looks, from the saved settings.") },
                  ]} />
                </div>
                <div>
                  <Sub icon="bulb">{t("Offer notes (AI ke liye)", "Offer notes (for the AI)")}</Sub>
                  <Defs items={[
                    { k: t("Aap kya offer karte ho", "What you offer"), d: t("Aapki service 1-2 line mein. Har mail ka main point yahi banta hai.", "Your service in 1-2 lines. This becomes the main point of every mail.") },
                    { k: t("Proof points (sirf sach)", "Proof points (true facts only)"), d: t("Asli results ya experience. Khaali = AI koi proof claim nahi karta.", "Real results or experience. Empty = the AI claims no proof.") },
                    { k: "Tone", d: t("Mail ka andaaz, jaise Friendly, short, honest.", "The style of the mail, e.g. Friendly, short, honest.") },
                  ]} />
                </div>
                <div>
                  <Sub icon="file">Email templates</Sub>
                  <p className="text-sm leading-relaxed text-slate-600">
                    {t(
                      <>3 fixed templates (Template 1, 2, 3). Har ek mein <b>Template ka naam</b>, <b>Subject</b> aur <b>Mail ka text</b>. Saath mein ek <b>Example lead</b> ke saath preview (Poori details / Sirf business naam) aur <b>Rules check</b> dikhta hai. Campaign mein Template chuno to yahi text jaata hai. <Code>{"{{business}}"}</Code> aur <Code>{"{{contact|there}}"}</Code> jaise placeholders har lead ki details se bharte hain. <a href="#ai-template" className="link">Poori list aur example</a></>,
                      <>3 fixed templates (Template 1, 2, 3). Each has a <b>Template name</b>, a <b>Subject</b> and the <b>Mail text</b>, with a preview for an <b>Example lead</b> (All details / Business name only) and a <b>Rules check</b>. Choose a Template in a campaign and this text is used. Placeholders like <Code>{"{{business}}"}</Code> and <Code>{"{{contact|there}}"}</Code> are filled with each lead&apos;s details. <a href="#ai-template" className="link">Full list and example</a></>,
                    )}
                  </p>
                </div>
                <div>
                  <Sub icon="clock">Sending rules</Sub>
                  <Defs items={[
                    { k: t("Sending din", "Sending days"), d: t("Sirf in dino mein mails jaati hain (campaign ke timezone mein).", "Mails go out only on these days (in the campaign's timezone).") },
                    { k: "Sending window", d: t("Kab se, Kab tak: roz sirf is samay ke beech, lead ke local time mein.", "Start and End: each day only between these times, in the lead's local time.") },
                    { k: t("Do mails ke beech gap (minute)", "Gap between mails (minutes)"), d: t("Har mail ke baad kam se kam aur zyada se zyada ke beech random gap.", "A random gap after every mail, between the minimum and the maximum.") },
                    { k: "Warm-up", d: t("Pehla din, Har din +, Max / din: naya domain dheere-dheere badhta hai.", "Day one, + per day, Max / day: a new domain ramps up slowly.") },
                    { k: "Mailbox plan", d: t("Plan limit / din. App kabhi iska 40% se zyada nahi bhejta. 0 = sirf warm-up.", "Plan limit / day. The app never sends more than 40% of it. 0 = warm-up only.") },
                    { k: t("Roz kitni mails jaayengi", "Mails per day"), d: t("Upar ki settings se roz ki limit ka preview (save ke baad update hota hai).", "A preview of the daily limit from the settings above (updates after saving).") },
                    { k: t("Har mail approve karke hi bhejo", "Approve every mail before sending"), d: t("On (recommended) = har mail Approve page pe rukti hai. Off = 5 samples ke baad drafts apne aap approve.", "On (recommended) = every mail waits on the Approve page. Off = after the 5 samples, drafts are approved automatically.") },
                  ]} />
                </div>
                <div>
                  <Sub icon="bot">{t("AI aur DNS", "AI and DNS")}</Sub>
                  <Defs items={[
                    { k: "AI: Base URL, Model", d: t("Kaunsi AI service aur model mail likhe (OpenAI, Groq, OpenRouter…). Key server ki .env mein AI_API_KEY.", "Which AI service and model writes the mails (OpenAI, Groq, OpenRouter…). The key is AI_API_KEY in the server's .env.") },
                    { k: "Domain health (DNS)", d: t("Sending domain (khaali = From address ka domain) aur DKIM selector (Hostinger pe aam taur pe hostingermail-a). Neeche pichhle DNS check ka poora result.", "Sending domain (empty = the From address's domain) and DKIM selector (on Hostinger usually hostingermail-a). Below: the full result of the last DNS check.") },
                    { k: <B v="primary" icon="check">{t("Settings save karo", "Save settings")}</B>, d: t("Neeche ki bar mein. Kuch bhi badlo to save zaroor karo. Save se mode (DRY-RUN / LIVE) kabhi nahi badalta.", "In the bar at the bottom. Always save after a change. Saving never changes the mode (DRY-RUN / LIVE).") },
                  ]} />
                </div>
              </MenuRow>
            </div>
          </Section>

          {/* ---------------- 7. CSV guide ---------------- */}
          <Section id="csv" icon="file" title={t("CSV file mein kya dena hai", "What to put in the CSV file")}
            sub={t("Jitni sach details, utni specific aur achhi mail", "The more true details, the more specific and better the mail")}>
            <p className="text-sm leading-relaxed text-slate-700">
              {t(
                "Har row = ek business. Pehli line mein column ke naam. Sirf email zaroori hai, par us business ke hisaab se achhi mail ke liye neeche wale columns bhi do.",
                "One row = one business. The first line holds the column names. Only email is required, but for a good mail that fits the business, give the other columns below too.",
              )}
            </p>

            <Sub icon="trending" className="mt-4">{t("Kitni details dein?", "How many details?")}</Sub>
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                { tone: "border-slate-200 bg-slate-50/60", head: "text-slate-600", title: t("Kam se kam", "Minimum"), cols: ["email", "business_name"], text: t("Mail chalegi, par general rahegi.", "Works, but the mail stays general.") },
                { tone: "border-indigo-200 bg-indigo-50/50", head: "text-indigo-700", title: t("Achha", "Good"), cols: ["+ contact_name", "website", "city", "country"], text: t("‘Hello Marco,’ naam se, sahi bhasha mein, lead ke office time mein.", "‘Hello Marco,’ by name, in the right language, during the lead's office hours.") },
                { tone: "border-emerald-200 bg-emerald-50/50", head: "text-emerald-700", title: t("Sabse achha", "Best"), cols: ["+ category", "about", "note"], text: t("Mail us business ke kaam ke hisaab se, bina kisi andaze ke.", "The mail fits what that business does, with no guessing.") },
              ]).map((x) => (
                <div key={x.title} className={`min-w-0 rounded-lg border p-3 ${x.tone}`}>
                  <div className={`text-2xs font-bold uppercase tracking-wider ${x.head}`}>{x.title}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">{x.cols.map((c) => <Code key={c}>{c}</Code>)}</div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{x.text}</p>
                </div>
              ))}
            </div>

            <Sub icon="list" className="mt-5">{t("Har column ka matlab (example ke saath)", "Every column (with an example)")}</Sub>
            <div className="card-flush !shadow-none">
              <div className="overflow-x-auto">
                <table className="tbl tbl-stack">
                  <thead><tr><th>Column</th><th>{t("Zaroori?", "Needed?")}</th><th>{t("Kya likhna hai", "What to write")}</th><th>Example</th></tr></thead>
                  <tbody>
                    {columns.map((r) => (
                      <tr key={r.c}>
                        <td className="md:min-w-[10rem]">
                          <Code>{r.c}</Code>
                          <div className="mt-1 text-2xs text-slate-400">{t("Import pe:", "On import:")} <span className="font-medium text-slate-500">{r.field}</span></div>
                        </td>
                        <td data-label={t("Zaroori?", "Needed?")}><Badge v={r.need} label={need[r.need].label} tone={need[r.need].tone} dot={false} /></td>
                        <td className="min-w-[14rem] text-slate-600">{r.what}</td>
                        <td data-label="Example" className="font-medium text-slate-800 [overflow-wrap:anywhere] md:min-w-[9rem]">{CSV_EXAMPLE[r.c]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <Sub icon="file" className="mt-5">{t("Wahi row CSV file mein aisi dikhti hai", "The same row as it looks in the CSV file")}</Sub>
            <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700">{CSV_TEXT}</pre>
            <p className="hint">
              {t(
                <>Ye Import page ki sample CSV ki pehli row hai (<B icon="download">Sample CSV download karo</B>). <Code>.example</Code> wale address sirf example hain, unhe kabhi mail nahi jaati. Kisi value mein comma ho to use &quot;double quotes&quot; mein rakho (Excel ye khud karta hai).</>,
                <>This is the first row of the sample CSV on the Import page (<B icon="download">Download sample CSV</B>). The <Code>.example</Code> addresses are only examples and can never be mailed. If a value contains a comma, put it in &quot;double quotes&quot; (Excel does this for you).</>,
              )}
            </p>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="min-w-0 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                <Sub icon="check-circle" className="!text-emerald-700">{t("Achhi mail ke liye", "For a good mail")}</Sub>
                <Dots mark="check" items={[
                  t("category + about + note jitna bharoge, mail utni specific hogi.", "The more you fill in category + about + note, the more specific the mail."),
                  t("contact_name mein sirf first name (Marco), taaki mail ‘Hello Marco,’ se shuru ho.", "Put only the first name in contact_name (Marco), so the mail starts with ‘Hello Marco,’."),
                  t("country zaroor do: isse bhasha aur timezone sahi set hote hain.", "Always give country: it sets the right language and timezone."),
                  t("note mein sirf wahi likho jo sach aur pakka ho (reviews, nayi branch, award).", "In note, write only what is true and certain (reviews, a new branch, an award)."),
                  t("Har row ka naam, email aur details alag hote hain; har mail mein us lead ki apni details hi aati hain.", "Every row has its own name, email and details; each mail uses only that lead's own details."),
                ]} />
              </div>
              <div className="min-w-0 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                <Sub icon="alert" className="!text-amber-700">{t("Dhyan do", "Good to know")}</Sub>
                <Dots mark="alert" items={[
                  t("AI sirf aapki di hui details aur business ki apni website ka title / description use karta hai. Jo nahi pata, wo nahi likhta.", "The AI uses only the details you give and the title / description of the business's own website. What it doesn't know, it doesn't write."),
                  t("AI kabhi andaza nahi lagata ki business kya karta hai, aur kabhi unki website pe comment nahi karta: ‘maine aapka homepage dekha, design achha nahi’ jaisi line kabhi nahi aati.", "The AI never guesses what a business does and never comments on their website: a line like ‘I saw your homepage, the design isn't great’ never appears."),
                  t("category / about na ho to mail general rehti hai. Aisi list ke liye Template achha hai.", "Without category / about, the mail stays general. For such a list, a Template works well."),
                  t("Column ke naam alag ho sakte hain (Business, Company, Ville, Prénom…): Import screen pe match kar lo. Excel (XLSX) bhi chalega, aur Import page pe sample CSV milti hai.", "Column names can differ (Business, Company, Ville, Prénom…): match them on the import screen. Excel (XLSX) works too, and the Import page has a sample CSV."),
                  t("marie.dupont@gmail.com jaise personal address ‘Review chahiye’ mein jaate hain; jobs@, privacy@ jaise role address skip hote hain. Ek business ke kai email hon to app ek hi rakhta hai.", "Personal-looking addresses like marie.dupont@gmail.com go to ‘Needs review’; role addresses like jobs@ or privacy@ are skipped. If a business has several emails, the app keeps only one."),
                ]} />
              </div>
            </div>
          </Section>

          {/* ---------------- 8. AI or template ---------------- */}
          <Section id="ai-template" icon="bot" title={t("AI ya Template: kab kya chunein", "AI or Template: which to choose")}
            sub={t("Campaign banate waqt ‘Mail kaise banegi’ mein chuno", "Choose under ‘How mails are written’ when you create a campaign")}>
            <div className="grid gap-3 md:grid-cols-2">
              <Option icon="bot" title={t("AI har lead ke liye likhega", "AI writes each mail")} tag={t("Har mail personal", "Every mail personal")}
                points={[
                  t("Har lead ki mail alag, uski CSV details (category, about, note, city…) se.", "A different mail for every lead, from its CSV details (category, about, note, city…)."),
                  t("AI sirf aapke Offer notes aur lead ki details use karta hai; jo nahi pata, wo nahi likhta.", "The AI uses only your Offer notes and the lead's details; it never writes what it doesn't know."),
                  t("Har mail padhna zaroori: har ek thodi alag hoti hai.", "Read every mail: each one is a little different."),
                ]}
                when={t("Kab: achhi details wali list, jahan har mail personal chahiye.", "When: a list with good details, where every mail should be personal.")} />
              <Option icon="file" title="Template 1 / 2 / 3" tag={t("Fixed text", "Fixed text")}
                points={[
                  t("Sabke liye same text; sirf naam, city, category jaisi jagah har lead ke hisaab se bharti hain.", "The same text for everyone; only spots like name, city and category are filled in per lead."),
                  t("Tez aur pakka: aapko pehle se pata hai har mail mein kya jayega.", "Fast and predictable: you know in advance what every mail says."),
                  t(
                    <><Link href="/settings#templates" className="link">Settings → Email templates</Link> mein likho. Pehle se 3 example templates bhare hain (jaise ‘Website intro’): inhe apne offer ke hisaab se badlo.</>,
                    <>Write them in <Link href="/settings#templates" className="link">Settings → Email templates</Link>. 3 example templates are filled in already (like ‘Website intro’): adapt them to your offer.</>,
                  ),
                  t("Template badla? Pehle bani draft pe campaign page pe ‘Template se dobara banao’ dabao.", "Changed a template? On drafts made earlier, press ‘Rebuild from template’ on the campaign page."),
                ]}
                when={t("Kab: kam details wali list, ya jab ek hi tested text sabko bhejna ho.", "When: a list with few details, or when you want to send one tested text to everyone.")} />
            </div>

            <div className="mt-4">
              <Callout tone="info" title={t("Dono ke liye same niyam", "The same rules for both")}>
                {t(
                  "Har mail wahi checks paas karti hai (60–110 words, aakhir mein sawaal, koi link nahi…) aur aapke approval ke bina nahi jaati. Template campaign ki bhasha mein likho: French campaign = French template.",
                  "Every mail passes the same checks (60–110 words, ends with a question, no links…) and goes out only with your approval. Write the template in the campaign's language: French campaign = French template.",
                )}
              </Callout>
            </div>

            <Sub icon="pencil" className="mt-5">{t("Template ke placeholders", "Template placeholders")}</Sub>
            <div className="card-flush !shadow-none">
              <div className="overflow-x-auto">
                <table className="tbl tbl-stack">
                  <thead><tr><th>Placeholder</th><th>{t("Kya aata hai", "What it becomes")}</th><th>Example</th></tr></thead>
                  <tbody>
                    {placeholders.map((x) => (
                      <tr key={x.p}>
                        <td className="whitespace-nowrap"><Code>{x.p}</Code></td>
                        <td data-label={t("Kya aata hai", "What it becomes")} className="text-slate-600">{x.means}</td>
                        <td data-label="Example" className="font-medium text-slate-800">{x.ex}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="hint">{t("| ke baad wala text tab aata hai jab CSV mein us lead ki value khaali ho.", "The text after | is used when that lead has no value in the CSV.")}</p>

            <Sub icon="eye" className="mt-5">{t("Example: ek template, do leads", "Example: one template, two leads")}</Sub>
            <div className="grid gap-3 md:grid-cols-3">
              {[
                { label: t("Template mein likha", "Written in the template"), text: TPL, tone: "border-slate-200 bg-slate-50" },
                { label: t("Lead: Marco, Lyon", "Lead: Marco, Lyon"), text: TPL_FULL, tone: "border-emerald-200 bg-emerald-50/40" },
                { label: t("Lead: contact aur city khaali", "Lead: no contact, no city"), text: TPL_EMPTY, tone: "border-indigo-200 bg-indigo-50/40" },
              ].map((x) => (
                <div key={x.label} className="min-w-0">
                  <div className="mb-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400">{x.label}</div>
                  <pre className={`whitespace-pre-wrap rounded-lg border p-3 font-mono text-[11px] leading-relaxed text-slate-700 [overflow-wrap:anywhere] ${x.tone}`}>{x.text}</pre>
                </div>
              ))}
            </div>
            <p className="hint">{t("(Settings mein Business = Brighton Solution maan ke.)", "(Assuming Business = Brighton Solution in Settings.)")}</p>
          </Section>

          {/* ---------------- 9. safety ---------------- */}
          <Section id="safety" icon="shield" title={t("Safety ke niyam (aasaan shabdon mein)", "Safety rules (in plain words)")}
            sub={t("Aapke domain aur naam ko safe rakhne ke liye app ye sab karta hai", "What the app does to keep your domain and your name safe")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Feature tone="emerald" icon="shield" title={t("Ek address, ek business: sirf ek mail", "One address, one business: one mail")}>
                {t("Har send se pehle Ledger check hota hai. Same domain wale business ko bhi doosri mail kabhi nahi jaati.", "The Ledger is checked before every send. A business on the same domain never gets a second mail either.")}
              </Feature>
              <Feature tone="emerald" icon="ban" title={t("Block List", "Block list")}>
                {t("Opt-out aur hard bounce apne aap block. Aap khud bhi email ya poora domain daal sakte ho.", "Opt-outs and hard bounces are blocked automatically. You can add emails or whole domains yourself too.")}
              </Feature>
              <Feature tone="emerald" icon="check-check" title={t("Har mail aapke approval se", "Every mail needs your approval")}>
                {t("Settings mein ‘Har mail approve karke hi bhejo’ on rakho (recommended). Aapke approve kiye bina kuch nahi jaata.", "Keep ‘Approve every mail before sending’ on in Settings (recommended). Nothing goes out without your approval.")}
              </Feature>
              <Feature tone="emerald" icon="clock" title={t("Sending window aur random gap", "Sending window and a random gap")}>
                {t("Mails sirf lead ke office time mein, chune hue dino mein, aur har mail ke beech kuch minute ka random gap, bilkul insaan ki tarah.", "Mails go out only in the lead's office hours, on the chosen days, with a random gap of a few minutes between mails, just like a person.")}
              </Feature>
              <Feature tone="emerald" icon="trending" title={t("Warm-up aur daily limit", "Warm-up and daily limit")}>
                {t("Naya domain dheere badhta hai (jaise pehle din 10, phir har sending din +5). Mailbox plan ki limit ka 40% se zyada kabhi nahi.", "A new domain ramps up slowly (e.g. 10 on day one, then +5 each sending day). Never more than 40% of the mailbox plan's limit.")}
              </Feature>
              <Feature tone="emerald" icon="stop" title="Auto-pause">
                {t("SMTP login, limit ya policy error, ek din mein 2 hard bounce, ya last 50 mails mein 5% se zyada bounce: sending apne aap ruk jaati hai aur Alert address pe mail aati hai.", "An SMTP login, limit or policy error, 2 hard bounces in one day, or over 5% bounces in the last 50 mails: sending stops by itself and a mail goes to your Alert address.")}
              </Feature>
              <Feature tone="emerald" icon="mail" title={t("Har mail mein footer", "A footer in every mail")}>
                {t("Address kahan se mila, ‘reply STOP’ se mail band karne ka tarika, aur aapka postal address.", "Where the address was found, how to stop mails by replying STOP, and your postal address.")}
              </Feature>
              <Feature tone="emerald" icon="lock" title={t("Koi link ya tracking nahi", "No links, no tracking")}>
                {t("Mail ke text mein koi link nahi (sirf signature mein aapki website). Koi tracking pixel nahi; logo bhi mail ke andar hi hota hai.", "No links in the mail text (only your website in the signature). No tracking pixel; even the logo is inside the mail itself.")}
              </Feature>
              <Feature tone="emerald" icon="pencil" title={t("Har mail ke niyam", "Rules for every mail")}>
                {t("60–110 words, aakhir mein ek sawaal, ALL CAPS nahi, ‘urgent’ ya ‘guarantee’ jaise shabd nahi, nakli ‘Re:’ subject nahi. AI ki mail, template aur aapka edit: sab pe same check.", "60–110 words, ends with a question, no ALL CAPS, no words like ‘urgent’ or ‘guarantee’, no fake ‘Re:’ subject. AI mails, templates and your edits all get the same check.")}
              </Feature>
              <Feature tone="emerald" icon="globe" title={t("SPF aur DKIM zaroori", "SPF and DKIM required")}>
                {t("Inke bina campaign start hi nahi hota, taaki mails spam mein na jaayein.", "Without them a campaign does not even start, so mails don't land in spam.")}
              </Feature>
              <Feature tone="emerald" icon="eye" title={t("Koi andaza nahi", "No guessing")}>
                {t("AI sirf CSV ki details, business ki apni website ka title / description aur aapke Offer notes use karta hai. Website pe comment kabhi nahi.", "The AI uses only the CSV details, the title / description of the business's own website and your Offer notes. It never comments on the website.")}
              </Feature>
            </div>
          </Section>

          {/* ---------------- 10. problems and fixes ---------------- */}
          <Section flush id="faq" icon="alert" title={t("Problem aaye to kya karein", "Common problems and fixes")}
            sub={t("Sawaal pe click karo, jawab khulega", "Click a question to see the answer")}>
            <div>
              <Faq q={t("Koi mail nahi ja rahi. Kyun?", "No mail is going out. Why?")}>
                <p>{t("Ek-ek karke ye check karo:", "Check these one by one:")}</p>
                <Dots mark="check" items={[
                  t(<>DRY-RUN on hai? Tab mails sirf aapke Test address pe jaati hain ({M("/sent")} → Dry-run tab).</>, <>Is DRY-RUN on? Then mails only go to your Test address ({M("/sent")} → Dry-run tab).</>),
                  t("Sending window ke bahar ho, ya aaj sending din nahi? Dashboard ka ‘Agli mail kab’ dekho.", "Outside the sending window, or not a sending day? See ‘Next mail’ on the Dashboard."),
                  t("Aaj ki limit poori ho gayi? Dashboard ka ‘Bheji / limit’ dekho.", "Today's limit reached? See ‘Sent / limit’ on the Dashboard."),
                  t(<>Koi mail approve nahi ki? {M("/review")} dekho.</>, <>Nothing approved yet? See {M("/review")}.</>),
                  t("Campaign ruka hua hai ya start nahi hua? Campaign page pe ‘Resume karo’, ya samples approve karke start karo.", "Is the campaign paused or not started? Press ‘Resume’ on the campaign page, or approve the samples and start."),
                  t("STOP ya auto-pause on hai? Laal patti dikhegi; Dashboard pe wajah padho.", "Is STOP or auto-pause on? A red strip shows; read the reason on the Dashboard."),
                  t("Worker band hai? Agla sawaal dekho.", "Is the worker down? See the next question."),
                ]} />
              </Faq>
              <Faq q={t("‘Worker nahi chal raha’ dikh raha hai", "It says ‘The worker is not running’")}>
                <p>{t(
                  <>Worker hi mails bhejta hai aur inbox padhta hai. Server pe <Code>pm2 status</Code> chalao: <Code>outreach-worker</Code> ‘online’ hona chahiye. Band ho to <Code>pm2 restart outreach-worker</Code>. Wajah dekhni ho to <Code>pm2 logs outreach-worker</Code>.</>,
                  <>The worker is what sends mails and reads the inbox. On the server, run <Code>pm2 status</Code>: <Code>outreach-worker</Code> must be ‘online’. If it is not, run <Code>pm2 restart outreach-worker</Code>. To see why, run <Code>pm2 logs outreach-worker</Code>.</>,
                )}</p>
              </Faq>
              <Faq q={t("SPF ya DKIM missing hai", "SPF or DKIM is missing")}>
                <p>{t(
                  "Hostinger hPanel ke DNS Zone mein SPF (TXT record) aur DKIM record check karo. DKIM selector Settings → Domain health mein hai (Hostinger: hostingermail-a). Theek karke Settings mein ‘DNS check karo’ dobara dabao. DNS badlav dikhne mein kabhi kabhi kuch ghante lagte hain.",
                  "Check the SPF (TXT record) and DKIM record in the DNS Zone of Hostinger hPanel. The DKIM selector is in Settings → Domain health (Hostinger: hostingermail-a). After fixing, press ‘Check DNS’ in Settings again. DNS changes can sometimes take a few hours to show.",
                )}</p>
              </Faq>
              <Faq q={t("Test mail nahi aayi", "The test mail did not arrive")}>
                <p>{t(
                  "Pehle spam / junk folder dekho. Settings mein Test address sahi hai? ‘SMTP test’ chalao: fail ho to host, port, SSL switch aur server .env ka SMTP_PASSWORD check karo. Logs → ‘Sirf errors’ mein wajah dekho.",
                  "First check the spam / junk folder. Is the Test address in Settings correct? Run ‘SMTP test’: if it fails, check the host, port, SSL switch and SMTP_PASSWORD in the server's .env. See the reason in Logs → ‘Errors only’.",
                )}</p>
              </Faq>
              <Faq q={<>{t("Lead pe ye likha hai:", "A lead shows:")} <Badge v="check_manual" /></>}>
                <p>{t(
                  "Mail server ne saaf jawab nahi diya (jaise timeout), isliye pata nahi mail gayi ya nahi. Hostinger webmail ke Sent folder mein lead ka email dhoondo. Mili = contact page pe ‘Haan, mail gayi thi’. Nahi mili = ‘Nahi gayi (band karo)’. Dono do baar dabane hote hain. Ye mail apne aap kabhi dobara nahi jaati; khud bhi dobara mat bhejo.",
                  "The mail server gave no clear answer (e.g. a timeout), so it is unclear whether the mail went out. Search for the lead's email in the Sent folder of Hostinger webmail. Found = ‘Yes, it was sent’ on the contact page. Not found = ‘No, not sent (close)’. Both need two presses. This mail is never resent automatically; don't resend it yourself either.",
                )}</p>
              </Faq>
              <Faq q={<>{t("Lead pe ye likha hai:", "A lead shows:")} <Badge v="needs_review" /></>}>
                <p>{t(
                  "Address kisi insaan ka personal lagta hai (jaise marie.dupont@gmail.com), isliye app ne khud nahi bheja. Contacts → ‘Review chahiye’ chip → Approve (campaign mein jayega) ya Reject (kabhi mail nahi). Campaign ke Ready leads khatam hone se pehle karo.",
                  "The address looks like a person's private one (like marie.dupont@gmail.com), so the app did not mail it on its own. Contacts → ‘Needs review’ chip → Approve (it joins the campaign) or Reject (never mailed). Do it before the campaign's Ready leads run out.",
                )}</p>
              </Faq>
              <Faq q={t("Bounce rate ki warning aayi", "A bounce rate warning appeared")}>
                <p>{t(
                  "Last 50 mails mein 2% se zyada bounce = warning. 5% se zyada (ya ek din mein 2 hard bounce) = sending apne aap ruk jaati hai. Matlab list purani ya galat hai. Contacts mein Bounce wale dekho, list ka source check karo aur achhi list lao. Phir Dashboard pe ‘Stop / alert hatao’ aur campaigns Resume karo.",
                  "Over 2% bounces in the last 50 mails = a warning. Over 5% (or 2 hard bounces in one day) = sending stops by itself. It means the list is old or wrong. Look at the bounced leads in Contacts, check where the list came from and get a better one. Then use ‘Clear stop / alert’ on the Dashboard and resume the campaigns.",
                )}</p>
              </Faq>
              <Faq q={t("Sab kuch turant rokna hai", "I need to stop everything right now")}>
                <p>{t(
                  <>{M("/")} → <B v="danger" icon="stop">Saari sending roko</B>. Turant koi mail nahi jaati aur chalte campaigns Pause ho jaate hain. Wapas shuru: <B icon="check-circle">Stop / alert hatao</B> (do baar), phir har campaign pe <B v="primary" icon="play">Resume karo</B>. Sirf ek campaign rokna ho to uske page pe <B icon="pause">Pause karo</B>.</>,
                  <>{M("/")} → <B v="danger" icon="stop">Stop all sending</B>. No mail goes out from that moment and running campaigns are paused. To start again: <B icon="check-circle">Clear stop / alert</B> (twice), then <B v="primary" icon="play">Resume</B> on each campaign. To stop just one campaign, press <B icon="pause">Pause</B> on its page.</>,
                )}</p>
              </Faq>
              <Faq q={t("Laal patti: ‘Sending apne aap ruk gayi’", "Red strip: ‘Sending was paused automatically’")}>
                <p>{t(
                  "App ne problem dekh ke khud roka. Dashboard ke laal box mein wajah padho aur Logs → ‘Sirf errors’ dekho. Problem theek karo (jaise SMTP password, mailbox ki limit, kharab list), phir ‘Stop / alert hatao’ aur campaigns Resume karo.",
                  "The app saw a problem and stopped by itself. Read the reason in the red box on the Dashboard and check Logs → ‘Errors only’. Fix the problem (e.g. the SMTP password, the mailbox limit, a bad list), then use ‘Clear stop / alert’ and resume the campaigns.",
                )}</p>
              </Faq>
              <Faq q={t("Mail ka text pasand nahi aaya", "I don't like a mail's text")}>
                <p>{t(
                  "Approve page pe: chhoti galti = ‘Text edit karo’; poori nayi mail = ‘Naya version likho’; lead hi galat = ‘Reject karo’. Saari AI mails kamzor lagein to Settings → Offer notes behtar likho, CSV mein category / about / note do, ya Template use karo.",
                  "On the Approve page: small mistake = ‘Edit text’; a whole new mail = ‘Write a new version’; wrong lead = ‘Reject’. If all AI mails feel weak, improve Settings → Offer notes, give category / about / note in the CSV, or use a Template.",
                )}</p>
              </Faq>
              <Faq q={t("Approve ki hui mail ab nahi bhejni", "I approved a mail but no longer want it sent")}>
                <p>{t(
                  "Us lead ka email Block List mein daal do: wo mail nahi jayegi. Isliye LIVE karne se pehle DRY-RUN ki approvals dhyan se dekh lo.",
                  "Add that lead's email to the Block list: the mail will not go out. That is why you should check your DRY-RUN approvals carefully before going LIVE.",
                )}</p>
              </Faq>
              <Faq q={t("Leads ko mail kis naam se dikhti hai?", "Which name do leads see?")}>
                <p>{t(
                  "Settings → Sender profile → ‘Inbox mein naam (From name)’, jaise Brighton Solution. Khaali ho to Business ka naam. Pakka karne ke liye DRY-RUN ki test mail apne inbox mein dekho.",
                  "Settings → Sender profile → ‘Name in the inbox (From name)’, e.g. Brighton Solution. If it is empty, the Business name is used. To be sure, look at a DRY-RUN test mail in your own inbox.",
                )}</p>
              </Faq>
              <Faq q={t("Reply ka jawab kaise dun?", "How do I answer a reply?")}>
                <p>{t(
                  "Apne mailbox (Hostinger webmail) se, normal mail ki tarah. Ye app replies sirf dikhata hai, bhejta nahi.",
                  "From your own mailbox (Hostinger webmail), like any normal mail. This app only shows replies; it does not send them.",
                )}</p>
              </Faq>
              <Faq q={t("Kya ek business ko do baar mail ja sakti hai?", "Can a business get two mails?")}>
                <p>{t(
                  "Nahi. Address ya business (same domain) Ledger mein ho to use dobara kabhi cold mail nahi jaati, kisi bhi list ya campaign se.",
                  "No. If the address or the business (same domain) is in the Ledger, it never gets another cold mail, from any list or campaign.",
                )}</p>
              </Faq>
            </div>
          </Section>

          {/* ---------------- 11. words ---------------- */}
          <Section id="words" icon="message" title={t("Mushkil shabd, aasaan matlab", "Tricky words, simple meanings")}>
            <dl className="grid gap-x-6 sm:grid-cols-2 [&>div:last-child]:border-b-0 sm:[&>div:nth-last-child(2):nth-child(odd)]:border-b-0">
              {words.map((x) => (
                <div key={x.w} className="min-w-0 border-b border-slate-100 py-2.5">
                  <dt className="text-sm font-semibold text-slate-900">{x.w}</dt>
                  <dd className="mt-0.5 text-sm leading-relaxed text-slate-600">{x.d}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <NextStep tone="emerald" title={t("Ab shuru karo", "Ready to start")} href="/" cta={t("Dashboard kholo", "Open dashboard")}
            text={t("Dashboard ka ‘Aapka agla step’ aapko har baar batayega ki aage kya karna hai.", "The ‘Your next step’ box on the Dashboard always tells you what to do next.")} />
        </div>

        {tocSide}
      </div>
    </div>
  );
}
