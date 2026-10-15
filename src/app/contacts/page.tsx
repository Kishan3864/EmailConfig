import Link from "next/link";
import { C, rows, type Lead, type Campaign } from "@/lib/fsdb";
import { Badge, Callout, EmptyState, NextStep, PageHeader, Section } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { Info } from "@/components/Info";
import { ActionButton } from "@/components/ActionButton";
import { ToastOnMount } from "@/components/toast";
import { fmt } from "@/lib/time";
import type { Lang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { approveLead, rejectLead } from "../actions";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Contacts", "Contacts") };
}

// status value -> label in both languages (the values stay the same, only the text is translated; same words as the status badges)
const STATUSES: [string, Record<Lang, string>][] = [
  ["ready", { hi: "Ready", en: "Ready" }], ["needs_review", { hi: "Review chahiye", en: "Needs review" }], ["sent", { hi: "Sent", en: "Sent" }],
  ["replied", { hi: "Reply aaya", en: "Replied" }], ["bounced", { hi: "Bounce", en: "Bounced" }], ["opted_out", { hi: "Opt-out", en: "Opted out" }],
  ["check_manual", { hi: "Manual check", en: "Manual check" }], ["failed", { hi: "Fail", en: "Failed" }], ["suppressed", { hi: "Block list", en: "Blocked" }],
  ["rejected", { hi: "Reject kiya", en: "Rejected" }], ["already_contacted", { hi: "Pehle contact hua", en: "Already contacted" }],
];
const LABEL: Record<string, Record<Lang, string>> = Object.fromEntries(STATUSES);
const CHIPS: [string, string][] = [["", ""], ["needs_review", "bg-amber-500"], ["check_manual", "bg-red-500"], ["ready", "bg-sky-500"], ["sent", "bg-emerald-500"], ["replied", "bg-violet-500"]];
const PAGE = 100;

export default async function Contacts({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { t, lang } = await getT();
  const { q = "", status = "", page = "1" } = await searchParams;
  const p = Math.max(1, +page || 1);
  const base = status ? C.leads.where("status", "==", status) : C.leads;
  const [leadSnap, campSnap] = await Promise.all([base.orderBy("updatedAt", "desc").limit(q ? 5000 : p * PAGE + 1).get(), C.campaigns.get()]);
  let leads = rows<Lead>(leadSnap);
  if (q) leads = leads.filter((l) => `${l.email} ${l.businessName || ""} ${l.website || ""}`.toLowerCase().includes(q.toLowerCase()));
  const more = leads.length > p * PAGE;
  leads = leads.slice((p - 1) * PAGE, p * PAGE);
  const camps = new Map(rows<Campaign>(campSnap).map((c) => [c.id, c.name]));
  const qs = (o: Record<string, string>) => "?" + new URLSearchParams({ q, status, ...o }).toString();
  const label = (s: string) => LABEL[s]?.[lang] ?? s;

  const filtered = !!(q || status);
  const review = leads.filter((l) => l.status === "needs_review").length;
  const manual = leads.filter((l) => l.status === "check_manual").length;
  const n = leads.length;
  // campaigns that Ready contacts on this page already belong to
  const readyCamps = [...new Set(leads.filter((l) => l.status === "ready" && l.campaignId).map((l) => l.campaignId as string))];
  const oneCamp = readyCamps.length === 1 && camps.has(readyCamps[0]) ? readyCamps[0] : null;

  // where to go after this page
  const next: { text: string; href?: string; cta?: string; tone?: "indigo" | "emerald" | "amber" } | null = !n ? null
    : status === "needs_review" ? {
      text: t("Har contact ko Approve ya Reject karo. Approve kiye contacts ki mail AI likhega, aur wo mail Approve page pe aapka intezaar karegi.",
        "Approve or reject each contact. The AI writes a mail for every approved contact, and that mail waits for you on the Approve page."),
      href: "/review", cta: t("Approve page kholo", "Open Approve page") }
    : status === "check_manual" ? {
      text: t("Har contact kholo, mailbox ka Sent folder dekho aur mark karo ki mail gayi thi ya nahi.",
        "Open each contact, check the Sent folder in your mailbox and mark whether the mail went out."),
      href: `/contacts/${encodeURIComponent(leads[0].id)}`, cta: t("Pehla contact kholo", "Open first contact"), tone: "amber" }
    : review ? {
      text: review === 1
        ? t("Is page pe 1 contact review ke liye ruka hai. Use Approve ya Reject karo, tabhi wo aage badhega.",
          "1 contact on this page is waiting for review. It only moves on once you approve or reject it.")
        : t(`Is page pe ${review} contacts review ke liye ruke hain. Unhe Approve ya Reject karo, tabhi wo aage badhenge.`,
          `${review} contacts on this page are waiting for review. They only move on once you approve or reject them.`),
      href: qs({ status: "needs_review", page: "1" }), cta: t("Review wale dekho", "See contacts to review"), tone: "amber" }
    : leads.some((l) => l.status === "sent" || l.status === "replied") ? {
      text: t("Jinhe mail chali gayi hai unke jawab Replies page pe aate hain. Kisi bhi email pe click karke uski poori history dekho.",
        "Replies from contacts you mailed show up on the Replies page. Click any email to see its full history."),
      href: "/replies", cta: t("Replies dekho", "See replies") }
    : leads.some((l) => l.status === "ready" && !l.campaignId) ? {
      text: t("Ready contacts ko mail bhejne ke liye unki list se campaign banao.", "To mail the Ready contacts, create a campaign from their list."),
      href: "/campaigns", cta: t("Campaigns kholo", "Open campaigns") }
    : readyCamps.length ? {
      text: t("Ye Ready contacts campaign mein hain. Campaign chalne pe AI inki mails likhega, phir wo Approve page pe aayengi. Campaign chal raha hai ya nahi, wahan dekho.",
        "These Ready contacts are in a campaign. While it runs, the AI writes their mails, and then they appear on the Approve page. Check whether the campaign is running."),
      href: oneCamp ? `/campaigns/${oneCamp}` : "/campaigns", cta: oneCamp ? t("Campaign kholo", "Open campaign") : t("Campaigns kholo", "Open campaigns") }
    : {
      text: t("In contacts ko ab koi mail nahi jayegi. Kya hua tha, ye dekhne ke liye kisi bhi email pe click karo.",
        "These contacts will not get any more mail. Click any email to see what happened."),
      ...(filtered ? { href: "/contacts", cta: t("Sab contacts dekho", "See all contacts") } : {}) };

  const empty: { icon: IconName; title: string; text: string; href: string; cta: string } =
    p > 1 ? {
      icon: "list", title: t("Is page pe koi contact nahi", "No contacts on this page"),
      text: t("Ye list itni lambi nahi hai. Pehle page se dekho.", "The list is not that long. Start from the first page."),
      href: qs({ page: "1" }), cta: t("Pehle page pe jao", "Go to first page") }
    : !filtered ? {
      icon: "users", title: t("Abhi koi contact nahi hai", "No contacts yet"),
      text: t("Leads ki list import karo. Har sahi email yahan ek contact ban jayega.", "Import a list of leads. Every valid email becomes a contact here."),
      href: "/import", cta: t("Leads import karo", "Import leads") }
    : status === "needs_review" && !q ? {
      icon: "check-check", title: t("Koi contact review ke liye nahi ruka", "No contacts waiting for review"),
      text: t("Sab contacts check ho chuke hain. Ab Approve page pe AI ki likhi mails padho.", "All contacts have been checked. Now read the AI-written mails on the Approve page."),
      href: "/review", cta: t("Approve page kholo", "Open Approve page") }
    : status === "check_manual" && !q ? {
      icon: "check-circle", title: t("Koi manual check baaki nahi", "No manual checks left"),
      text: t("Har bheji gayi mail ka result pakka hai.", "Every sent mail has a confirmed result."),
      href: "/contacts", cta: t("Sab contacts dekho", "See all contacts") }
    : {
      icon: "search", title: t("Is filter mein koi contact nahi mila", "No contacts match this filter"),
      text: t("Doosra search ya status try karo.", "Try another search or status."),
      href: "/contacts", cta: t("Filter hatao", "Clear filter") };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contacts"
        info={t("Yahan aapke saare leads ek jagah hain. Search karo ya status se filter karo, aur 'Review chahiye' wale contacts ko yahin Approve ya Reject karo. Kisi bhi email pe click karo to uski poori detail aur history khulegi. CSV export mein abhi wala filter lagta hai.",
          "All your leads in one place. Search or filter by status, and approve or reject 'Needs review' contacts right here. Click any email to open its full details and history. The CSV export uses the current filter.")}
        sub={t("Har lead ka status, campaign aur history", "Status, campaign and history of every lead")}
        actions={<a className="btn" href={`/api/export${qs({})}`}><Icon name="download" size={14} />{t("CSV export karo", "Export CSV")}</a>}
      />

      <form className="card space-y-3" role="search">
        <div className="flex flex-col gap-2 md:flex-row">
          <div className="relative min-w-0 flex-1">
            <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input name="q" defaultValue={q} placeholder={t("Email, business ya website search karo", "Search email, business or website")} aria-label="Search" className="input pl-9" />
          </div>
          <div className="flex gap-2">
            <select name="status" defaultValue={status} aria-label="Status" className="input min-w-0 flex-1 md:w-48 md:flex-none">
              <option value="">{t("Sab status", "All statuses")}</option>
              {STATUSES.map(([v, l]) => <option key={v} value={v}>{l[lang]}</option>)}
            </select>
            <button className="btn-primary shrink-0"><Icon name="filter" size={14} />{t("Filter karo", "Filter")}</button>
            {filtered && <Link href="/contacts" className="btn-ghost shrink-0 max-sm:w-9 max-sm:px-0" title={t("Saare filter hatao", "Clear all filters")} aria-label={t("Saaf karo", "Clear")}><Icon name="x" size={14} /><span className="hidden sm:inline">{t("Saaf karo", "Clear")}</span></Link>}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
          <div className="flex min-w-0 gap-1.5 overflow-x-auto scrollbar-none max-md:pr-4 max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-20px),transparent)]">
            {CHIPS.map(([s, dot]) => (
              <Link key={s || "all"} href={qs({ status: s, page: "1" })} aria-current={status === s ? "true" : undefined}
                className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium ring-1 ring-inset transition ${status === s ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900"}`}>
                {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}{s ? label(s) : t("Sab", "All")}
              </Link>
            ))}
          </div>
          <Info title={t("Search aur filter", "Search and filter")}
            text={t("Search box email, business ka naam aur website mein dhundhta hai. Status chuno to sirf us status wale contacts dikhenge. Chips se ek click mein filter lagao, aur 'Saaf karo' se saare filter hat jaate hain.",
              "The search box looks in the email, business name and website. Pick a status to see only contacts with that status. The chips filter in one click, and 'Clear' removes all filters.")} />
        </div>
      </form>

      {status === "needs_review" && n > 0 && (
        <Callout tone="info" title={t("Ye contacts aapke review ke liye ruke hain", "These contacts are waiting for your review")}>
          {t("Inka address personal lag raha tha (jaise kisi insaan ka naam), isliye app ne inhe khud nahi bheja. Approve karo to ye campaign mein jayega. Reject karo to is address pe kabhi mail nahi jayegi.",
            "Their addresses looked personal (like a person's name), so the app did not mail them on its own. Approve a contact and it joins the campaign. Reject it and that address will never be emailed.")}
        </Callout>
      )}
      {status === "check_manual" && n > 0 && (
        <Callout tone="danger" title={t("Inka send result pakka nahi hai", "Their send result is uncertain")}>
          {t("Bhejte waqt kuch gadbad hui, isliye pata nahi mail gayi ya nahi. Mailbox ka Sent folder check karo, phir contact kholke mark karo. Ye mail apne aap kabhi dobara nahi jayegi.",
            "Something went wrong while sending, so it is unclear whether the mail went out. Check the Sent folder in your mailbox, then open the contact and mark it. These mails are never resent automatically.")}
        </Callout>
      )}
      {status !== "check_manual" && manual > 0 && (
        <>
          <Callout tone="danger"
            title={t(`${manual} ${manual === 1 ? "contact" : "contacts"} ka send result pakka nahi hai`, `${manual} ${manual === 1 ? "contact has" : "contacts have"} an uncertain send result`)}
            action={<Link className="btn btn-sm" href={qs({ status: "check_manual", page: "1" })}>{t("Manual check wale dekho", "See manual checks")}<Icon name="arrow-right" size={13} /></Link>}>
            {t("Sent folder check karke har ek ko mark karna hai. Tab tak ye apne aap dobara nahi jayengi.", "Check the Sent folder and mark each one. Until then, they are not resent automatically.")}
          </Callout>
          <ToastOnMount kind="warning" title={t("Kuch mails ka result pakka nahi", "Some mails have an uncertain result")}
            text={t("Contacts mein 'Manual check' wale kholo aur Sent folder dekh ke mark karo.", "Open the 'Manual check' contacts and mark them after checking the Sent folder.")}
            once={`contacts-manual-${manual}`} />
        </>
      )}

      {n ? (
        <Section flush icon="users" title={status ? t(`${label(status)} wale contacts`, `Contacts: ${label(status)}`) : t("Sab contacts", "All contacts")}
          sub={`${n === 1 ? t("1 contact dikh raha hai", "Showing 1 contact") : t(`${n} contacts dikh rahe hain`, `Showing ${n} contacts`)}${q ? t(` · "${q}" ke liye`, ` · for "${q}"`) : ""}${p > 1 || more ? ` · Page ${p}` : ""}`}
          info={t("Har row ek lead hai, sabse naya update sabse upar. Status batata hai lead kis step pe hai: Ready = mail ke liye taiyaar, Sent = mail chali gayi, Reply aaya = jawab aaya. Email pe click karke poori detail aur history dekho. Ek page pe 100 contacts dikhte hain.",
            "Each row is one lead, most recently updated first. The status shows which step a lead is at: Ready = ready for a mail, Sent = the mail went out, Replied = they wrote back. Click an email to see the full details and history. A page shows 100 contacts.")}>
          <div className="overflow-x-auto">
            <table className="tbl tbl-stack [&_td]:align-middle">
              <thead>
                <tr><th>Email / Business</th><th>Website</th><th>Status</th><th>Campaign</th><th>{t("Last update", "Last updated")}</th>{review > 0 && <th className="text-right">Approve / Reject</th>}</tr>
              </thead>
              <tbody>
                {leads.map((l) => {
                  const camp = l.campaignId ? camps.get(l.campaignId) : undefined;
                  return (
                    <tr key={l.id}>
                      <td className="max-w-[260px]">
                        <Link href={`/contacts/${encodeURIComponent(l.id)}`} className="group flex min-w-0 items-center gap-2.5">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-indigo-50 text-2xs font-semibold uppercase text-indigo-600">{(l.businessName || l.email).charAt(0)}</span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-indigo-600 group-hover:text-indigo-700 group-hover:underline">{l.email}</span>
                            {l.businessName && <span className="hidden truncate text-xs text-slate-500 md:block">{l.businessName}</span>}
                          </span>
                        </Link>
                      </td>
                      {/* phones: own row in the card; desktop: shown under the email */}
                      <td data-label="Business" className="md:hidden">{l.businessName || <span className="text-slate-300">—</span>}</td>
                      <td data-label="Website"><span className="block min-w-0 max-w-[180px] truncate text-slate-500" title={l.website}>{l.website || "—"}</span></td>
                      <td data-label="Status"><Badge v={l.status} /></td>
                      <td data-label="Campaign">
                        {camp ? <Link href={`/campaigns/${l.campaignId}`} className="text-slate-700 hover:text-indigo-600 hover:underline">{camp}</Link> : <span className="text-slate-300">—</span>}
                      </td>
                      <td data-label={t("Last update", "Last updated")} className="whitespace-nowrap text-slate-500">{fmt(l.updatedAt)}</td>
                      {review > 0 && (
                        <td className="whitespace-nowrap">
                          {l.status === "needs_review" && (
                            <div className="flex gap-1.5 pt-1 md:justify-end md:pt-0">
                              <ActionButton action={approveLead.bind(null, l.id)} label="Approve" icon="check" className="btn-sm btn-success" okTitle={t("Contact approve ho gaya", "Contact approved")} />
                              <ActionButton action={rejectLead.bind(null, l.id)} label="Reject" icon="x" className="btn btn-sm" confirmText={t("Dobara dabao", "Press again")} okTitle={t("Contact reject ho gaya", "Contact rejected")} />
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(p > 1 || more) && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 sm:px-5">
              <span className="text-xs text-slate-500">Page {p}</span>
              <div className="flex gap-2">
                {p > 1 && <Link className="btn btn-sm" href={qs({ page: String(p - 1) })}><Icon name="chevron-left" size={14} />{t("Peeche", "Previous")}</Link>}
                {more && <Link className="btn btn-sm" href={qs({ page: String(p + 1) })}>{t("Aage", "Next")}<Icon name="chevron-right" size={14} /></Link>}
              </div>
            </div>
          )}
        </Section>
      ) : (
        <div className="card-flush"><EmptyState {...empty} /></div>
      )}

      {next && <NextStep {...next} />}
    </div>
  );
}
