import type { IconName } from "./icons";

export type NavItem = { href: string; label: string; short: string; icon: IconName; info: string };

/** Every menu of the app, grouped for the sidebar. `info` is shown in the (i) and in the mobile menu. */
export const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: "Main",
    items: [
      { href: "/", label: "Dashboard", short: "Home", icon: "dashboard", info: "Sab kuch ek nazar mein: aaj kitni mails gayi, kitni approval ke liye ruki hain, agla step kya hai aur koi problem to nahi." },
    ],
  },
  {
    title: "Mail ka flow",
    items: [
      { href: "/import", label: "Leads Import", short: "Import", icon: "upload", info: "Leads ki list (CSV, Excel, PDF ya text) upload karo. App har email check karta hai: galat, duplicate ya pehle contact hua address apne aap skip ho jata hai. Pehli baar import se pehle Ledger mein Sent folder import kar lo." },
      { href: "/campaigns", label: "Campaigns", short: "Campaigns", icon: "megaphone", info: "Import ki hui list se campaign banao. Pehle 5 sample mails banti hain; unhe padh ke approve karo, tabhi campaign start hota hai." },
      { href: "/review", label: "Approve Karo", short: "Approve", icon: "check-check", info: "AI ki likhi mails yahan aapke approval ke liye rukti hain (jab Settings mein 'Har mail approve karke hi bhejo' on ho). Padho, edit karo ya reject karo; sirf approve ki hui mail hi bheji jaati hai." },
      { href: "/sent", label: "Bheji Gayi Mails", short: "Sent", icon: "send", info: "Din ke hisaab se dekho kaunsi mail kab, kisko aur kis text ke saath gayi. Fail hui mails bhi yahin dikhti hain." },
    ],
  },
  {
    title: "Leads",
    items: [
      { href: "/contacts", label: "Contacts", short: "Contacts", icon: "users", info: "Saare leads ek jagah. Search karo, status se filter karo, 'Review chahiye' wale approve ya reject karo, aur CSV export karo." },
      { href: "/replies", label: "Replies (Inbox)", short: "Replies", icon: "inbox", info: "Leads ke jawab, opt-out, bounce aur auto-reply yahan aate hain. Inbox har 10 minute mein apne aap sync hota hai." },
    ],
  },
  {
    title: "Suraksha",
    items: [
      { href: "/ledger", label: "Contacted Ledger", short: "Ledger", icon: "shield", info: "Jin emails ko kabhi bhi mail gayi hai unki permanent list. Is list ka koi bhi address dobara kabhi cold mail nahi paayega." },
      { href: "/suppression", label: "Block List", short: "Block", icon: "ban", info: "Yahan daale gaye email ya poore domain ko kabhi mail nahi jaayegi. Opt-out aur bounce apne aap yahan aa jaate hain." },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/logs", label: "Logs", short: "Logs", icon: "activity", info: "App aur worker ka record: kya hua, kab hua, koi error aaya to yahan dikhega. SMTP server ke jawab bhi yahin milte hain." },
      { href: "/settings", label: "Settings", short: "Settings", icon: "settings", info: "Mailbox (SMTP/IMAP), sender profile, sending rules, AI aur DNS ki setting. Pehli baar yahin se shuru karo." },
    ],
  },
];

/** Bottom tab bar on phones (the rest is under "Aur"). */
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
