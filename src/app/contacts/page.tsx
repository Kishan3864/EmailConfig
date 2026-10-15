import Link from "next/link";
import { C, rows, type Lead, type Campaign } from "@/lib/fsdb";
import { Badge, Callout, EmptyState, NextStep, PageHeader, Section } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { Info } from "@/components/Info";
import { ActionButton } from "@/components/ActionButton";
import { ToastOnMount } from "@/components/toast";
import { fmt } from "@/lib/time";
import { approveLead, rejectLead } from "../actions";

export const metadata = { title: "Contacts" };

// status value -> Hinglish label (the values stay the same, only the text is translated)
const STATUSES: [string, string][] = [
  ["ready", "Ready"], ["needs_review", "Review chahiye"], ["sent", "Sent"], ["replied", "Reply aaya"], ["bounced", "Bounce"], ["opted_out", "Opt-out"],
  ["check_manual", "Manual check"], ["failed", "Fail"], ["suppressed", "Block list"], ["rejected", "Reject kiya"], ["already_contacted", "Pehle contact hua"],
];
const LABEL: Record<string, string> = Object.fromEntries(STATUSES);
const CHIPS: [string, string][] = [["", ""], ["needs_review", "bg-amber-500"], ["check_manual", "bg-red-500"], ["ready", "bg-sky-500"], ["sent", "bg-emerald-500"], ["replied", "bg-violet-500"]];
const PAGE = 100;

export default async function Contacts({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
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

  const filtered = !!(q || status);
  const review = leads.filter((l) => l.status === "needs_review").length;
  const manual = leads.filter((l) => l.status === "check_manual").length;
  const n = leads.length;
  // campaigns that Ready contacts on this page already belong to
  const readyCamps = [...new Set(leads.filter((l) => l.status === "ready" && l.campaignId).map((l) => l.campaignId as string))];
  const oneCamp = readyCamps.length === 1 && camps.has(readyCamps[0]) ? readyCamps[0] : null;

  // where to go after this page
  const next: { text: string; href?: string; cta?: string; tone?: "indigo" | "emerald" | "amber" } | null = !n ? null
    : status === "needs_review" ? { text: "Har contact ko Approve ya Reject karo. Approve kiye contacts ki mail AI likhega, aur wo mail Approve page pe aapka intezaar karegi.", href: "/review", cta: "Approve page kholo" }
    : status === "check_manual" ? { text: "Har contact kholo, mailbox ka Sent folder dekho aur mark karo ki mail gayi thi ya nahi.", href: `/contacts/${encodeURIComponent(leads[0].id)}`, cta: "Pehla contact kholo", tone: "amber" }
    : review ? { text: review === 1 ? "Is page pe 1 contact review ke liye ruka hai. Use Approve ya Reject karo, tabhi wo aage badhega." : `Is page pe ${review} contacts review ke liye ruke hain. Unhe Approve ya Reject karo, tabhi wo aage badhenge.`, href:qs({ status: "needs_review", page: "1" }), cta: "Review wale dekho", tone: "amber" }
    : leads.some((l) => l.status === "sent" || l.status === "replied") ? { text: "Jinhe mail chali gayi hai unke jawab Replies page pe aate hain. Kisi bhi email pe click karke uski poori history dekho.", href: "/replies", cta: "Replies dekho" }
    : leads.some((l) => l.status === "ready" && !l.campaignId) ? { text: "Ready contacts ko mail bhejne ke liye unki list se campaign banao.", href: "/campaigns", cta: "Campaigns kholo" }
    : readyCamps.length ? { text: "Ye Ready contacts campaign mein hain. Campaign chalne pe AI inki mails likhega, phir wo Approve page pe aayengi. Campaign chal raha hai ya nahi, wahan dekho.", href: oneCamp ? `/campaigns/${oneCamp}` : "/campaigns", cta: oneCamp ? "Campaign kholo" : "Campaigns kholo" }
    : { text: "In contacts ko ab koi mail nahi jayegi. Kya hua tha, ye dekhne ke liye kisi bhi email pe click karo.", ...(filtered ? { href: "/contacts", cta: "Sab contacts dekho" } : {}) };

  const empty: { icon: IconName; title: string; text: string; href: string; cta: string } =
    p > 1 ? { icon: "list", title: "Is page pe koi contact nahi", text: "Ye list itni lambi nahi hai. Pehle page se dekho.", href: qs({ page: "1" }), cta: "Pehle page pe jao" }
    : !filtered ? { icon: "users", title: "Abhi koi contact nahi hai", text: "Leads ki list import karo. Har sahi email yahan ek contact ban jayega.", href: "/import", cta: "Leads import karo" }
    : status === "needs_review" && !q ? { icon: "check-check", title: "Koi contact review ke liye nahi ruka", text: "Sab contacts check ho chuke hain. Ab Approve page pe AI ki likhi mails padho.", href: "/review", cta: "Approve page kholo" }
    : status === "check_manual" && !q ? { icon: "check-circle", title: "Koi manual check baaki nahi", text: "Har bheji gayi mail ka result pakka hai.", href: "/contacts", cta: "Sab contacts dekho" }
    : { icon: "search", title: "Is filter mein koi contact nahi mila", text: "Doosra search ya status try karo.", href: "/contacts", cta: "Filter hatao" };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contacts"
        info="Yahan aapke saare leads ek jagah hain. Search karo ya status se filter karo, aur 'Review chahiye' wale contacts ko yahin Approve ya Reject karo. Kisi bhi email pe click karo to uski poori detail aur history khulegi. CSV export mein abhi wala filter lagta hai."
        sub="Har lead ka status, campaign aur history"
        actions={<a className="btn" href={`/api/export${qs({})}`}><Icon name="download" size={14} />CSV export karo</a>}
      />

      <form className="card space-y-3" role="search">
        <div className="flex flex-col gap-2 md:flex-row">
          <div className="relative min-w-0 flex-1">
            <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input name="q" defaultValue={q} placeholder="Email, business ya website search karo" aria-label="Search" className="input pl-9" />
          </div>
          <div className="flex gap-2">
            <select name="status" defaultValue={status} aria-label="Status" className="input min-w-0 flex-1 md:w-48 md:flex-none">
              <option value="">Sab status</option>
              {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button className="btn-primary shrink-0"><Icon name="filter" size={14} />Filter karo</button>
            {filtered && <Link href="/contacts" className="btn-ghost shrink-0 max-sm:w-9 max-sm:px-0" title="Saare filter hatao" aria-label="Saaf karo"><Icon name="x" size={14} /><span className="hidden sm:inline">Saaf karo</span></Link>}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
          <div className="flex min-w-0 gap-1.5 overflow-x-auto scrollbar-none max-md:pr-4 max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-20px),transparent)]">
            {CHIPS.map(([s, dot]) => (
              <Link key={s || "all"} href={qs({ status: s, page: "1" })} aria-current={status === s ? "true" : undefined}
                className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium ring-1 ring-inset transition ${status === s ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900"}`}>
                {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}{s ? LABEL[s] : "Sab"}
              </Link>
            ))}
          </div>
          <Info title="Search aur filter" text="Search box email, business ka naam aur website mein dhundhta hai. Status chuno to sirf us status wale contacts dikhenge. Chips se ek click mein filter lagao, aur 'Saaf karo' se saare filter hat jaate hain." />
        </div>
      </form>

      {status === "needs_review" && n > 0 && (
        <Callout tone="info" title="Ye contacts aapke review ke liye ruke hain">
          Inka address personal lag raha tha (jaise kisi insaan ka naam), isliye app ne inhe khud nahi bheja. Approve karo to ye campaign mein jayega. Reject karo to is address pe kabhi mail nahi jayegi.
        </Callout>
      )}
      {status === "check_manual" && n > 0 && (
        <Callout tone="danger" title="Inka send result pakka nahi hai">
          Bhejte waqt kuch gadbad hui, isliye pata nahi mail gayi ya nahi. Mailbox ka Sent folder check karo, phir contact kholke mark karo. Ye mail apne aap kabhi dobara nahi jayegi.
        </Callout>
      )}
      {status !== "check_manual" && manual > 0 && (
        <>
          <Callout tone="danger" title={`${manual} ${manual === 1 ? "contact" : "contacts"} ka send result pakka nahi hai`} action={<Link className="btn btn-sm" href={qs({ status: "check_manual", page: "1" })}>Manual check wale dekho<Icon name="arrow-right" size={13} /></Link>}>
            Sent folder check karke har ek ko mark karna hai. Tab tak ye apne aap dobara nahi jayengi.
          </Callout>
          <ToastOnMount kind="warning" title="Kuch mails ka result pakka nahi" text="Contacts mein 'Manual check' wale kholo aur Sent folder dekh ke mark karo." once={`contacts-manual-${manual}`} />
        </>
      )}

      {n ? (
        <Section flush icon="users" title={status ? `${LABEL[status] || status} wale contacts` : "Sab contacts"}
          sub={`${n === 1 ? "1 contact dikh raha hai" : `${n} contacts dikh rahe hain`}${q ? ` · "${q}" ke liye` : ""}${p > 1 || more ? ` · Page ${p}` : ""}`}
          info="Har row ek lead hai, sabse naya update sabse upar. Status batata hai lead kis step pe hai: Ready = mail ke liye taiyaar, Sent = mail chali gayi, Reply aaya = jawab aaya. Email pe click karke poori detail aur history dekho. Ek page pe 100 contacts dikhte hain.">
          <div className="overflow-x-auto">
            <table className="tbl tbl-stack [&_td]:align-middle">
              <thead>
                <tr><th>Email / Business</th><th>Website</th><th>Status</th><th>Campaign</th><th>Last update</th>{review > 0 && <th className="text-right">Approve / Reject</th>}</tr>
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
                      <td data-label="Last update" className="whitespace-nowrap text-slate-500">{fmt(l.updatedAt)}</td>
                      {review > 0 && (
                        <td className="whitespace-nowrap">
                          {l.status === "needs_review" && (
                            <div className="flex gap-1.5 pt-1 md:justify-end md:pt-0">
                              <ActionButton action={approveLead.bind(null, l.id)} label="Approve" icon="check" className="btn-sm btn-success" okTitle="Contact approve ho gaya" />
                              <ActionButton action={rejectLead.bind(null, l.id)} label="Reject" icon="x" className="btn btn-sm" confirmText="Dobara dabao" okTitle="Contact reject ho gaya" />
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
                {p > 1 && <Link className="btn btn-sm" href={qs({ page: String(p - 1) })}><Icon name="chevron-left" size={14} />Peeche</Link>}
                {more && <Link className="btn btn-sm" href={qs({ page: String(p + 1) })}>Aage<Icon name="chevron-right" size={14} /></Link>}
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
