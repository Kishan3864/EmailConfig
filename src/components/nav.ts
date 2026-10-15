import type { Lang } from "@/lib/i18n";
import type { IconName } from "./icons";

/** A text in both UI languages. */
export type Text = { hi: string; en: string };
export const pickText = (lang: Lang, x: Text) => (lang === "en" ? x.en : x.hi);

export type NavItem = { href: string; label: Text; short: Text; icon: IconName; info: Text };

/** Every menu of the app, grouped for the sidebar. `info` is shown in the (i) and in the phone menu. */
export const NAV: { title: Text; items: NavItem[] }[] = [
  {
    title: { hi: "Main", en: "Main" },
    items: [
      {
        href: "/", icon: "dashboard", label: { hi: "Dashboard", en: "Dashboard" }, short: { hi: "Home", en: "Home" },
        info: {
          hi: "Sab kuch ek nazar mein: aaj kitni mails gayi, kitni approval ke liye ruki hain, agla step kya hai aur koi problem to nahi.",
          en: "Everything at a glance: how many mails went out today, how many wait for your approval, what the next step is and whether anything needs attention.",
        },
      },
      {
        href: "/help", icon: "bulb", label: { hi: "Kaise use karein", en: "How to use" }, short: { hi: "Guide", en: "Guide" },
        info: {
          hi: "Poore software ki aasaan guide: Test (DRY-RUN) aur LIVE ka flow, har menu aur har button ka kaam, aur CSV mein kya dena hai.",
          en: "A simple guide to the whole software: the Test (DRY-RUN) and LIVE flow, what every menu and button does, and what to put in the CSV.",
        },
      },
    ],
  },
  {
    title: { hi: "Mail ka flow", en: "Mail flow" },
    items: [
      {
        href: "/import", icon: "upload", label: { hi: "Leads Import", en: "Import leads" }, short: { hi: "Import", en: "Import" },
        info: {
          hi: "Leads ki list (CSV, Excel, PDF ya text) upload karo. App har email check karta hai: galat, duplicate ya pehle contact hua address apne aap skip ho jata hai. Pehli baar import se pehle Ledger mein Sent folder import kar lo.",
          en: "Upload a list of leads (CSV, Excel, PDF or text). The app checks every address: invalid, duplicate or already-contacted addresses are skipped automatically. Before your first import, import your Sent folder into the Ledger.",
        },
      },
      {
        href: "/campaigns", icon: "megaphone", label: { hi: "Campaigns", en: "Campaigns" }, short: { hi: "Campaigns", en: "Campaigns" },
        info: {
          hi: "Import ki hui list se campaign banao. Pehle 5 sample mails banti hain; unhe padh ke approve karo, tabhi campaign start hota hai.",
          en: "Create a campaign from an imported list. First 5 sample mails are written; read and approve them, and only then does the campaign start.",
        },
      },
      {
        href: "/review", icon: "check-check", label: { hi: "Approve Karo", en: "Approve mails" }, short: { hi: "Approve", en: "Approve" },
        info: {
          hi: "AI ki likhi mails yahan aapke approval ke liye rukti hain (jab Settings mein 'Har mail approve karke hi bhejo' on ho). Padho, edit karo ya reject karo; sirf approve ki hui mail hi bheji jaati hai.",
          en: "Mails written by the AI wait here for your approval (when 'Approve every mail before sending' is on in Settings). Read, edit or reject them; only approved mails are sent.",
        },
      },
      {
        href: "/sent", icon: "send", label: { hi: "Bheji Gayi Mails", en: "Sent mails" }, short: { hi: "Sent", en: "Sent" },
        info: {
          hi: "Din ke hisaab se dekho kaunsi mail kab, kisko aur kis text ke saath gayi. Fail hui mails bhi yahin dikhti hain.",
          en: "See day by day which mail went out when, to whom and with what text. Failed mails show up here too.",
        },
      },
    ],
  },
  {
    title: { hi: "Leads", en: "Leads" },
    items: [
      {
        href: "/contacts", icon: "users", label: { hi: "Contacts", en: "Contacts" }, short: { hi: "Contacts", en: "Contacts" },
        info: {
          hi: "Saare leads ek jagah. Search karo, status se filter karo, 'Review chahiye' wale approve ya reject karo, aur CSV export karo.",
          en: "All leads in one place. Search, filter by status, approve or reject leads that need review, and export a CSV.",
        },
      },
      {
        href: "/replies", icon: "inbox", label: { hi: "Replies (Inbox)", en: "Replies (Inbox)" }, short: { hi: "Replies", en: "Replies" },
        info: {
          hi: "Leads ke jawab, opt-out, bounce aur auto-reply yahan aate hain. Inbox har 10 minute mein apne aap sync hota hai.",
          en: "Replies from leads, opt-outs, bounces and auto-replies land here. The inbox syncs automatically every 10 minutes.",
        },
      },
    ],
  },
  {
    title: { hi: "Suraksha", en: "Safety" },
    items: [
      {
        href: "/ledger", icon: "shield", label: { hi: "Contacted Ledger", en: "Contacted ledger" }, short: { hi: "Ledger", en: "Ledger" },
        info: {
          hi: "Jin emails ko kabhi bhi mail gayi hai unki permanent list. Is list ka koi bhi address dobara kabhi cold mail nahi paayega.",
          en: "The permanent list of every address that was ever emailed. No address on this list will ever get a cold mail again.",
        },
      },
      {
        href: "/suppression", icon: "ban", label: { hi: "Block List", en: "Block list" }, short: { hi: "Block", en: "Block" },
        info: {
          hi: "Yahan daale gaye email ya poore domain ko kabhi mail nahi jaayegi. Opt-out aur bounce apne aap yahan aa jaate hain.",
          en: "Emails or whole domains added here are never emailed. Opt-outs and bounces are added automatically.",
        },
      },
    ],
  },
  {
    title: { hi: "System", en: "System" },
    items: [
      {
        href: "/logs", icon: "activity", label: { hi: "Logs", en: "Logs" }, short: { hi: "Logs", en: "Logs" },
        info: {
          hi: "App aur worker ka record: kya hua, kab hua, koi error aaya to yahan dikhega. SMTP server ke jawab bhi yahin milte hain.",
          en: "A record of the app and the worker: what happened and when, including errors. The mail server's replies are here too.",
        },
      },
      {
        href: "/settings", icon: "settings", label: { hi: "Settings", en: "Settings" }, short: { hi: "Settings", en: "Settings" },
        info: {
          hi: "Mailbox (SMTP/IMAP), sender profile, sending rules, AI aur DNS ki setting. Pehli baar yahin se shuru karo.",
          en: "Mailbox (SMTP/IMAP), sender profile, sending rules, AI and DNS settings. Start here the first time.",
        },
      },
    ],
  },
];

/** Bottom tab bar on phones (the rest is under "Aur" / "More"). */
export const MOBILE_TABS = ["/", "/review", "/sent", "/contacts"];

export const ALL_NAV = NAV.flatMap((g) => g.items);

export function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

/** The menu item a path belongs to (longest match), e.g. /campaigns/abc → Campaigns. */
export function findNav(pathname: string) {
  let best: NavItem | undefined;
  for (const it of ALL_NAV) if (isActive(it.href, pathname) && (!best || it.href.length > best.href.length)) best = it;
  return best;
}
