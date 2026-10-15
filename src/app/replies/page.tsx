import Link from "next/link";
import { C, rows, type Reply, type Message } from "@/lib/fsdb";
import { Badge, EmptyState, MailPreview, NextStep, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Info } from "@/components/Info";
import { fmt } from "@/lib/time";

export const metadata = { title: "Replies" };

// avatar colour per reply kind
const AVATAR: Record<string, string> = {
  reply: "bg-violet-50 text-violet-600", optout: "bg-orange-50 text-orange-600", bounce: "bg-red-50 text-red-600", softbounce: "bg-amber-50 text-amber-600", auto: "bg-slate-100 text-slate-500",
};

const isBounce = (kind: string) => kind === "bounce" || kind === "softbounce";

export default async function Replies({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const q = all ? C.replies.orderBy("receivedAt", "desc") : C.replies.where("kind", "in", ["reply", "optout"]).orderBy("receivedAt", "desc");
  const replies = rows<Reply>(await q.limit(200).get());
  const msgs = new Map<string, Message>();
  await Promise.all([...new Set(replies.map((r) => r.leadId).filter(Boolean) as string[])].map(async (id) => {
    const m = await C.messages.doc(id).get();
    if (m.exists) msgs.set(id, { id, ...m.data() } as Message);
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Replies (Inbox)"
        info="Worker har 10 minute mein aapka inbox sync karta hai. Kisi lead ka reply aate hi uska status 'Reply aaya' ho jata hai. Opt-out aur bounce wale address apne aap block list mein chale jaate hain, unhe dobara kabhi mail nahi jayegi."
        sub="Leads ke jawab, opt-out aur bounce ek jagah"
        actions={
          <div className="flex items-center gap-2">
            <div className="seg">
              <Link href="/replies" className={`seg-item ${!all ? "seg-item-on" : ""}`}><Icon name="reply" size={13} />Reply & opt-out</Link>
              <Link href="/replies?all=1" className={`seg-item ${all ? "seg-item-on" : ""}`}><Icon name="inbox" size={13} />Sab dikhao</Link>
            </div>
            <Info title="Kya dikhega?" text="'Reply & opt-out' mein sirf leads ke asli jawab aur mana karne wali mails dikhti hain. 'Sab dikhao' mein bounce (galat address) aur auto-reply (jaise out of office) bhi dikhte hain." />
          </div>
        }
      />

      {replies.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            {replies.length === 1 ? "1 mail" : `${replies.length} mails`} · nayi sabse upar
            <Info size={12} title="Har card mein kya hai?" text="Upar: kisne bheja aur kab. Beech mein: aapki bheji hui mail (click karke kholo). Neeche: unka jawab, aur doosri bhasha ho to English translation bhi. Bounce card mein neeche mail server ki report hoti hai ki mail kyun nahi pahunchi. Naam pe click karke us contact ki poori history dekho." />
          </span>
          {replies.length >= 200 && <span>Sirf latest 200 dikh rahi hain</span>}
        </div>
      )}

      {replies.map((r) => {
        const m = r.leadId ? msgs.get(r.leadId) : undefined;
        const bounce = isBounce(r.kind);
        // a bounce comes from the mail server (mailer-daemon@…): name the lead whose address bounced (lead id = its email key)
        const leadAddr = m?.leadEmail || (bounce && r.leadId) || undefined;
        const name = m?.businessName || leadAddr || r.fromEmail;
        return (
          <article key={r.id} className="card space-y-4">
            <header className="flex items-start gap-3">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold uppercase ${AVATAR[r.kind] || AVATAR.auto}`}>{name.charAt(0)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {r.leadId
                    ? <Link href={`/contacts/${encodeURIComponent(r.leadId)}`} className="link min-w-0 break-all">{name}</Link>
                    : <span className="min-w-0 break-all font-medium text-slate-900">{r.fromEmail}</span>}
                  <Badge v={r.kind} />
                </div>
                <div className="mt-0.5 flex flex-col text-xs text-slate-500 sm:flex-row sm:flex-wrap sm:gap-x-1.5">
                  {bounce && leadAddr && leadAddr !== name && <><span className="break-all">{leadAddr}</span><span aria-hidden="true" className="hidden sm:inline">·</span></>}
                  {name !== r.fromEmail && <><span className="break-all">{bounce ? `Mail server: ${r.fromEmail}` : r.fromEmail}</span><span aria-hidden="true" className="hidden sm:inline">·</span></>}
                  <span>{fmt(r.receivedAt)}</span>
                </div>
              </div>
            </header>

            {m && (
              <details className="group rounded-lg border border-slate-200/80 bg-slate-50/60">
                <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs text-slate-600 transition hover:text-slate-900">
                  <Icon name="send" size={13} className="text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">Aapki bheji mail: <span className="font-medium text-slate-800">{m.subject}</span> ({fmt(m.sentAt)})</span>
                  <Icon name="chevron-down" size={14} className="text-slate-400 transition group-open:rotate-180" />
                </summary>
                <div className={`grid gap-3 border-t border-slate-200/80 p-3 ${m.bodyEn ? "md:grid-cols-2" : ""}`}>
                  <MailPreview label="Aapki mail" subject={m.subject} text={m.body} />
                  {m.bodyEn && <MailPreview label="English translation" tone="translation" subject={m.subjectEn || undefined} text={m.bodyEn} />}
                </div>
              </details>
            )}

            <div className={`grid gap-4 ${r.bodyEn ? "md:grid-cols-2" : ""}`}>
              <MailPreview label={bounce ? "Bounce report (mail server ka jawab)" : "Unka jawab"} subject={r.subject ?? ""} text={r.body.slice(0, 4000)} />
              {r.bodyEn && <MailPreview label="English translation" tone="translation" text={r.bodyEn} />}
            </div>
          </article>
        );
      })}

      {replies.length ? (
        <NextStep tone="emerald" text="Reply ka jawab apne mailbox (Hostinger webmail) se do. Ye page sirf padhne ke liye hai, yahan se koi mail nahi jaati." href="/contacts?status=replied" cta="Reply wale contacts" />
      ) : (
        <>
          <div className="card-flush">
            <EmptyState icon="inbox" title={all ? "Inbox mein abhi kuch nahi aaya" : "Abhi koi reply nahi"}
              text="Worker har 10 minute mein inbox sync karta hai. Turant check karna ho to Settings mein 'Inbox abhi sync karo' dabao."
              href="/settings" cta="Settings kholo" />
          </div>
          <NextStep text="Jab tak reply nahi aata, dekho kaunsi mails kab aur kisko gayi hain." href="/sent" cta="Bheji gayi mails dekho" />
        </>
      )}
    </div>
  );
}
