import Link from "next/link";
import { C, rows, type Reply, type Message } from "@/lib/fsdb";
import { Badge, EmptyState, MailPreview, NextStep, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Info } from "@/components/Info";
import { englishOf } from "@/lib/english";
import { LANGS } from "@/lib/lang";
import { fmt } from "@/lib/time";
import { getT } from "@/lib/i18n-server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Replies", "Replies") };
}

// avatar colour per reply kind
const AVATAR: Record<string, string> = {
  reply: "bg-violet-50 text-violet-600", optout: "bg-orange-50 text-orange-600", bounce: "bg-red-50 text-red-600", softbounce: "bg-amber-50 text-amber-600", auto: "bg-slate-100 text-slate-500",
};

const isBounce = (kind: string) => kind === "bounce" || kind === "softbounce";

export default async function Replies({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { t } = await getT();
  const { all } = await searchParams;
  const q = all ? C.replies.orderBy("receivedAt", "desc") : C.replies.where("kind", "in", ["reply", "optout"]).orderBy("receivedAt", "desc");
  const replies = rows<Reply>(await q.limit(200).get());
  const msgs = new Map<string, Message>();
  await Promise.all([...new Set(replies.map((r) => r.leadId).filter(Boolean) as string[])].map(async (id) => {
    const m = await C.messages.doc(id).get();
    if (m.exists) msgs.set(id, { id, ...m.data() } as Message);
  }));
  const theirReply = t("Unka jawab", "Their reply");
  const bounceReport = t("Bounce report (mail server ka jawab)", "Bounce report (mail server reply)");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Replies (Inbox)"
        info={t("Worker har 10 minute mein aapka inbox sync karta hai. Kisi lead ka reply aate hi uska status 'Reply aaya' ho jata hai. Opt-out aur bounce wale address apne aap block list mein chale jaate hain, unhe dobara kabhi mail nahi jayegi.",
          "The worker syncs your inbox every 10 minutes. As soon as a lead replies, its status changes to 'Replied'. Opted-out and bounced addresses go to the block list automatically and will never be emailed again.")}
        sub={t("Leads ke jawab, opt-out aur bounce ek jagah", "Replies, opt-outs and bounces from leads in one place")}
        actions={
          <div className="flex items-center gap-2">
            <div className="seg">
              <Link href="/replies" className={`seg-item ${!all ? "seg-item-on" : ""}`}><Icon name="reply" size={13} />{t("Reply & opt-out", "Replies & opt-outs")}</Link>
              <Link href="/replies?all=1" className={`seg-item ${all ? "seg-item-on" : ""}`}><Icon name="inbox" size={13} />{t("Sab dikhao", "Show all")}</Link>
            </div>
            <Info title={t("Kya dikhega?", "What is shown?")}
              text={t("'Reply & opt-out' mein sirf leads ke asli jawab aur mana karne wali mails dikhti hain. 'Sab dikhao' mein bounce (galat address) aur auto-reply (jaise out of office) bhi dikhte hain.",
                "'Replies & opt-outs' shows only real replies from leads and mails saying no. 'Show all' also shows bounces (wrong addresses) and auto-replies (like out of office).")} />
          </div>
        }
      />

      {replies.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            {replies.length === 1 ? "1 mail" : `${replies.length} mails`} · {t("nayi sabse upar", "newest first")}
            <Info size={12} title={t("Har card mein kya hai?", "What is in each card?")}
              text={t("Upar: kisne bheja aur kab. Beech mein: aapki bheji hui mail (click karke kholo). Neeche: unka jawab, aur doosri bhasha ho to English translation bhi. Bounce card mein neeche mail server ki report hoti hai ki mail kyun nahi pahunchi. Naam pe click karke us contact ki poori history dekho.",
                "Top: who sent it and when. Middle: the mail you sent (click to open). Bottom: their reply, plus an English translation if it is in another language. In a bounce card, the bottom shows the mail server's report on why the mail did not arrive. Click the name to see that contact's full history.")} />
          </span>
          {replies.length >= 200 && <span>{t("Sirf latest 200 dikh rahi hain", "Showing only the latest 200")}</span>}
        </div>
      )}

      {replies.map((r) => {
        const m = r.leadId ? msgs.get(r.leadId) : undefined;
        const bounce = isBounce(r.kind);
        // a bounce comes from the mail server (mailer-daemon@…): name the lead whose address bounced (lead id = its email key)
        const leadAddr = m?.leadEmail || (bounce && r.leadId) || undefined;
        const name = m?.businessName || leadAddr || r.fromEmail;
        // the English of the mail I sent: only a translation made from its exact text (never a stale one)
        const en = m ? englishOf(m) : null;
        const sentEn = en?.kind === "ready" ? en : null;
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
                  <span className="min-w-0 flex-1 truncate">{t("Aapki bheji mail:", "Mail you sent:")} <span className="font-medium text-slate-800">{m.subject}</span> ({fmt(m.sentAt)})</span>
                  <Icon name="chevron-down" size={14} className="text-slate-400 transition group-open:rotate-180" />
                </summary>
                <div className={`grid gap-3 border-t border-slate-200/80 p-3 ${sentEn ? "md:grid-cols-2" : ""}`}>
                  <MailPreview label={sentEn ? `${t("Aapki mail", "Your mail")} · ${LANGS[m.language] || (m.language || "—").toUpperCase()}` : t("Aapki mail", "Your mail")} subject={m.subject} text={m.body} />
                  {sentEn && <MailPreview label="English translation" tone="translation" subject={sentEn.subject || undefined} text={sentEn.body} />}
                </div>
              </details>
            )}

            <div className={`grid gap-4 ${r.bodyEn ? "md:grid-cols-2" : ""}`}>
              <MailPreview label={bounce ? bounceReport : theirReply} subject={r.subject ?? ""} text={r.body.slice(0, 4000)} />
              {r.bodyEn && <MailPreview label="English translation" tone="translation" text={r.bodyEn} />}
            </div>
          </article>
        );
      })}

      {replies.length ? (
        <NextStep tone="emerald"
          text={t("Reply ka jawab apne mailbox (Hostinger webmail) se do. Ye page sirf padhne ke liye hai, yahan se koi mail nahi jaati.",
            "Answer replies from your own mailbox (Hostinger webmail). This page is read-only; no mail is sent from here.")}
          href="/contacts?status=replied" cta={t("Reply wale contacts", "Replied contacts")} />
      ) : (
        <>
          <div className="card-flush">
            <EmptyState icon="inbox" title={all ? t("Inbox mein abhi kuch nahi aaya", "Nothing in the inbox yet") : t("Abhi koi reply nahi", "No replies yet")}
              text={t("Worker har 10 minute mein inbox sync karta hai. Turant check karna ho to Settings mein 'Inbox abhi sync karo' dabao.",
                "The worker syncs the inbox every 10 minutes. To check right away, press 'Sync inbox now' in Settings.")}
              href="/settings" cta={t("Settings kholo", "Open settings")} />
          </div>
          <NextStep text={t("Jab tak reply nahi aata, dekho kaunsi mails kab aur kisko gayi hain.", "Until replies come in, see which mails went out, when and to whom.")}
            href="/sent" cta={t("Bheji gayi mails dekho", "See sent mails")} />
        </>
      )}
    </div>
  );
}
