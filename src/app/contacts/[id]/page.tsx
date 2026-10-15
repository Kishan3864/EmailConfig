import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { C, EVENTS, key, rows, type Lead, type Message, type Reply, type SendLog, type EventRow, type LeadList, type Campaign } from "@/lib/fsdb";
import { Badge, Callout, MailPreview, NextStep, PageHeader, Section, type Tone } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { Info } from "@/components/Info";
import { ActionButton } from "@/components/ActionButton";
import { ToastOnMount } from "@/components/toast";
import { factChips, parseFacts } from "@/components/factChips";
import { fmt } from "@/lib/time";
import { approveLead, rejectLead, markCheckedSent, markCheckedNotSent } from "../../actions";

export const metadata = { title: "Contact" };

type Mail = Message & { approved?: boolean };

// history event type -> Hinglish label, icon, colour
const EV: Record<string, [string, IconName, Tone]> = {
  draft: ["Draft bana (AI ne mail likhi)", "pencil", "slate"],
  edited: ["Draft haath se edit hua", "pencil", "slate"],
  approved: ["Contact approve hua", "check", "emerald"],
  rejected: ["Contact reject hua", "x", "slate"],
  approved_mail: ["Mail approve hui", "check-check", "emerald"],
  rejected_mail: ["Mail reject hui", "x", "slate"],
  dry_run: ["Dry-run: test address pe gayi", "flask", "amber"],
  sending: ["Bhejna shuru hua", "send", "sky"],
  sent: ["Mail chali gayi", "check-circle", "emerald"],
  smtp_error: ["SMTP error aaya", "x-circle", "red"],
  skipped: ["Skip hua (mail nahi gayi)", "ban", "slate"],
  check_manual: ["Manual check chahiye", "alert", "red"],
  manual: ["Manual check ke baad mark kiya", "user", "indigo"],
  replied: ["Reply aaya", "reply", "violet"],
  opted_out: ["Opt-out kiya", "ban", "orange"],
  auto_reply: ["Auto-reply aaya", "bot", "slate"],
  bounced: ["Mail bounce hui", "x-circle", "red"],
};
const DOT: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-500", sky: "bg-sky-50 text-sky-600", amber: "bg-amber-50 text-amber-600", emerald: "bg-emerald-50 text-emerald-600",
  violet: "bg-violet-50 text-violet-600", red: "bg-red-50 text-red-600", orange: "bg-orange-50 text-orange-600", indigo: "bg-indigo-50 text-indigo-600",
};
const MAILED = ["sent", "replied", "bounced", "opted_out", "check_manual"];
const isBounce = (kind: string) => kind === "bounce" || kind === "softbounce";

// History: the app writes its own notes in English. Hinglish here; null = the label already says it.
const NOTE = new Map<string, string | null>([
  ["validated draft created", null],
  ["draft edited by hand", null],
  ["approved after review", null],
  ["rejected after review", null],
  ["mail approved for sending", null],
  ["mail rejected: this lead will not be emailed", "Is lead ko ab mail nahi jayegi."],
  ["marked as sent after manual check", "Result: mail gayi thi."],
  ["marked as not sent after manual check (never resent automatically)", "Result: mail nahi gayi. Ye apne aap kabhi dobara nahi jayegi."],
  ["worker stopped mid-send; never resent automatically", "Bhejte waqt worker ruk gaya, pata nahi mail gayi ya nahi. Ye apne aap kabhi dobara nahi jayegi."],
]);
// "not sent: <reason>" from the worker
const SKIP_WHY = new Map([
  ["blocked", "Ye address ya business pehle se Ledger mein tha, isliye nahi bheji."],
  ["suppressed", "Address ya domain Block List mein hai, isliye nahi bheji."],
  ["lost", "Bhejte waqt status badal gaya (jaise campaign ruka), isliye abhi nahi bheji."],
]);
// "<kind>: <server reply>" from the worker
const SMTP_WHY = new Map([
  ["retry", "Server ne abhi mana kiya. 3 koshish tak agle sending din dobara try hoti hai."],
  ["hard", "Address galat ya band hai (pakka bounce), isliye Block List mein chala gaya."],
  ["pause", "Login, limit ya policy ki problem. Saari sending apne aap rok di gayi."],
  ["uncertain", "Pata nahi chala mail gayi ya nahi. Manual check chahiye."],
]);
// errors the app itself stores on a message; anything else is the SMTP server's reply, shown as it is
const APP_ERR = new Map([
  ["worker stopped mid-send", "Bhejte waqt worker ruk gaya (pata nahi mail gayi ya nahi)"],
  ["address or business already in the contacted ledger", "Ye address ya business pehle se Ledger mein tha"],
  ["unknown result", "Server se koi saaf jawab nahi aaya"],
]);
const errText = (e: string) => APP_ERR.get(e) ?? <span className="font-mono">{e}</span>;

/** Text under a history event: the note in Hinglish (or nothing) and the server reply apart, so it shows only once. */
function eventDetail(e: EventRow): { note?: string; server?: string } {
  const d = (e.detail || "").trim();
  if (!d) return {};
  if (NOTE.has(d)) return { note: NOTE.get(d) ?? undefined };
  switch (e.type) {
    case "sending": { const n = /^attempt (\d+)$/.exec(d); return { note: n ? `Koshish ${n[1]}` : d }; }
    case "skipped": { const r = /^not sent: (\w+)$/.exec(d); return { note: (r && SKIP_WHY.get(r[1])) || d }; }
    case "smtp_error": { const r = /^(\w+): ([\s\S]*)$/.exec(d); return r && SMTP_WHY.has(r[1]) ? { note: SMTP_WHY.get(r[1]), server: r[2] } : { server: d }; }
    case "dry_run": return { server: d.replace(/^delivered to test address:\s*/, "") };
    case "sent": return { server: d };
    case "replied": case "auto_reply": case "bounced": return { note: `Subject: ${d}` };
    case "opted_out": return { note: `Unhone likha: "${d}"` };
    default: return { note: d };
  }
}

/** What the ledger entry means for this address right now. */
function ledgerNote(status: string, manualCheck: boolean) {
  if (status === "refused_will_retry") return "Server ne abhi mana kiya. Yahi mail agle sending din dobara try hogi (zyada se zyada 3 baar). Koi doosri mail kabhi nahi jayegi.";
  if (status === "uncertain") return `Pata nahi mail gayi ya nahi${manualCheck ? ", upar mark karo" : ""}. Ye dobara kabhi apne aap nahi jayegi.`;
  return "Ab is address pe kabhi dobara mail nahi jayegi.";
}

/** Label + value. Phone: one row (label left, value right) like a native list. Bigger screens: label above value in a grid. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-slate-100 py-2.5 sm:block sm:border-0 sm:py-0">
      <div className="shrink-0 text-xs font-medium text-slate-400 sm:mb-0.5">{label}</div>
      <div className="min-w-0 break-words text-right text-sm text-slate-800 sm:text-left">{children}</div>
    </div>
  );
}

function pretty(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

type Next = { text: string; href?: string; cta?: string; tone?: "indigo" | "emerald" | "amber" };
function nextFor(l: Lead, m: Mail | null, campHref: string): Next {
  switch (l.status) {
    case "needs_review": return { text: "Upar se Approve ya Reject karo. Approve karne pe ye contact campaign ke saath mail paayega.", tone: "amber" };
    case "check_manual": return { text: "Mailbox ka Sent folder check karke upar mark karo ki mail gayi thi ya nahi.", tone: "amber" };
    case "ready":
      if (!l.campaignId) return { text: "Ye contact ready hai par kisi campaign mein nahi hai. Iski list se campaign banao, tabhi ise mail jayegi.", href: "/campaigns", cta: "Campaign mein daalo" };
      // no draft yet: the Approve page has nothing for this contact, the campaign page shows whether it is running
      if (!m) return { text: "Campaign chalne pe AI iski mail likhega, phir wo Approve page pe aayegi. Campaign chal raha hai ya nahi, campaign page pe dekho.", href: campHref, cta: "Campaign kholo" };
      if (m.status !== "ready") return { text: "Is mail ko bhejne ka kaam chal raha hai. Worker apne aap try karega, result Bheji Gayi Mails mein dikhega.", href: "/sent", cta: "Bheji gayi mails dekho" };
      // approved mails are not on the Approve page any more (it lists only approved == false)
      if (m.approved === true) return m.dryRunDone
        ? { text: "Ye mail approve hai aur DRY-RUN mein test address pe ja chuki hai. LIVE on hone ke baad sending window mein ye lead ko apne aap jayegi.", href: "/sent", cta: "Bheji gayi mails dekho" }
        : { text: "Mail approve ho chuki hai. Sending window mein worker ise apne aap bhejega (DRY-RUN mode mein sirf aapke test address pe).", href: "/sent", cta: "Bheji gayi mails dekho" };
      return { text: "Iski mail ban chuki hai. Approve page pe padh ke approve karo, phir sending window mein worker ise bhej dega.", href: "/review", cta: "Approve page kholo" };
    case "sent": return { text: "Mail chali gayi. Reply aaya to Replies page pe dikhega aur status 'Reply aaya' ho jayega.", href: "/replies", cta: "Replies dekho", tone: "emerald" };
    case "replied": return { text: "Is lead ne jawab diya hai. Jawab apne mailbox (Hostinger webmail) se do.", href: "/replies", cta: "Replies dekho", tone: "emerald" };
    case "bounced": return { text: "Ye address bounce hua (galat ya band hai). Ye block list mein chala gaya, ab ise kabhi mail nahi jayegi.", href: "/contacts", cta: "Baaki contacts dekho" };
    case "opted_out": return { text: "Is lead ne mana kar diya (opt-out). Ye block list mein hai, ab ise kabhi mail nahi jayegi.", href: "/contacts", cta: "Baaki contacts dekho" };
    default: return { text: "Is contact ko ab koi mail nahi jayegi. Baaki contacts dekho.", href: "/contacts", cta: "Contacts pe wapas jao" };
  }
}

export default async function Contact({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const ld = await C.leads.doc(id).get();
  if (!ld.exists) notFound();
  const l = { id, ...ld.data() } as Lead;
  const [md, list, camp, ledger, replySnap, eventSnap, sendSnap] = await Promise.all([
    C.messages.doc(id).get(), C.lists.doc(l.listId).get(), l.campaignId ? C.campaigns.doc(l.campaignId).get() : null, C.contacted.doc(key(l.email)).get(),
    C.replies.where("leadId", "==", id).get(), C.leads.doc(id).collection(EVENTS).orderBy("at").get(), C.sendLogs.where("leadId", "==", id).get(),
  ]);
  const m = md.exists ? ({ id, ...md.data() } as Mail) : null;
  const replies = rows<Reply>(replySnap).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const events = rows<EventRow>(eventSnap);
  const sends = rows<SendLog>(sendSnap).sort((a, b) => a.at.localeCompare(b.at));
  const ls = list.data() as LeadList | undefined;
  const cn = camp?.exists ? (camp.data() as Campaign).name : "—";
  const campHref = l.campaignId && camp?.exists ? `/campaigns/${l.campaignId}` : "/campaigns";
  const lg = ledger.exists ? { status: String(ledger.get("status") || ""), at: ledger.get("at") as string | undefined } : null;
  const facts = l.facts ? factChips(parseFacts(l.facts)) : [];

  const site = l.website?.trim() || "";
  const siteUrl = /^https?:\/\/\S+$/i.test(site) ? site : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(site) ? `https://${site}` : null;
  const mailed = MAILED.includes(l.status) || !!m?.sentAt;
  // once the mail went out, an error left from an earlier attempt is history, not the reason
  const wentOut = !!m && (m.status === "sent" || !!m.sentAt);

  // One send is stored twice: a send log and a sent / smtp_error / dry_run event with the same server reply.
  // Show it once, as the event; keep only the send logs without a twin (e.g. a failed dry run).
  const twins = new Set<string>();
  const loneSends = sends.filter((s) => {
    if (s.dryRun && !s.ok) return true;
    const type = s.dryRun ? "dry_run" : s.ok ? "sent" : "smtp_error";
    const at = Date.parse(s.at);
    const reply = (s.response || "").slice(0, 200);
    const ev = events.find((x) => !twins.has(x.id) && x.type === type && Math.abs(Date.parse(x.at) - at) < 5 * 60000 && (x.detail || "").includes(reply));
    if (ev) twins.add(ev.id);
    return !ev;
  });

  // events and SMTP attempts in one timeline, oldest first
  type Item = { k: string; at: string; label: string; icon: IconName; tone: Tone; badge?: ReactNode; note?: string; server?: string };
  const items: Item[] = [
    ...events.map((e): Item => {
      const [label, icon, tone]: [string, IconName, Tone] = EV[e.type] || [e.type.replace(/_/g, " "), "dot", "slate"];
      return { k: "e" + e.id, at: e.at, label, icon, tone, ...eventDetail(e) };
    }),
    ...loneSends.map((s): Item => ({
      k: "s" + s.id, at: s.at, label: s.dryRun ? "SMTP (dry-run)" : "SMTP", icon: "server", tone: s.ok ? "emerald" : "red",
      badge: <Badge v={s.ok ? "sent" : "failed"} />, note: `Kisko: ${s.to}`, server: s.response,
    })),
  ].sort((a, b) => (a.at || "").localeCompare(b.at || ""));

  return (
    <div className="space-y-4">
      <PageHeader
        title={l.businessName || l.email}
        back={{ href: "/contacts", label: "Contacts" }}
        info="Is contact ki poori kahani ek jagah: basic jaankari, AI ki likhi mail, aaye hue jawab aur har step ki history. Agar upar koi laal ya peela box dikhe to pehle wahi kaam karo."
        sub={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">{l.businessName && <span className="break-all">{l.email}</span>}<Badge v={l.status} /></span>}
      />

      {l.status === "needs_review" && (
        <Callout tone="warn" title="Ye contact aapke review ke liye ruka hai"
          action={<>
            <ActionButton action={approveLead.bind(null, id)} label="Approve karo" icon="check" className="btn-success flex-1 sm:flex-none" okTitle="Contact approve ho gaya"
              next={l.campaignId ? campHref : "/campaigns"} nextCta={l.campaignId ? "Campaign kholo" : "Campaign banao"} />
            <ActionButton action={rejectLead.bind(null, id)} label="Reject karo" icon="x" className="btn flex-1 sm:flex-none" confirmText="Dobara dabao" okTitle="Contact reject ho gaya" next="/contacts" nextCta="Contacts pe wapas jao" />
          </>}>
          Iska address personal lag raha tha (jaise kisi insaan ka naam), isliye app ne ise khud nahi bheja. Approve karo to ye campaign mein jayega, Reject karo to ise kabhi mail nahi jayegi.
        </Callout>
      )}
      {l.status === "check_manual" && (
        <>
          <Callout tone="danger"
            title={<>Is mail ka result pakka nahi hai <Info size={13} title="Kaise check karein?" text="Webmail ke Sent folder mein is lead ka email search karo. Haan = status Sent; Nahi = status Fail. Dono mein ye mail dobara kabhi apne aap nahi jayegi." /></>}
            action={<>
              <ActionButton action={markCheckedSent.bind(null, id)} label="Haan, mail gayi thi" icon="check" className="btn w-full sm:w-auto" confirmText="Dobara dabao: pakka?" okTitle="Sent mark ho gaya" />
              <ActionButton action={markCheckedNotSent.bind(null, id)} label="Nahi gayi (band karo)" icon="x" className="btn w-full sm:w-auto" confirmText="Dobara dabao: pakka?" okTitle="Not sent mark ho gaya" />
            </>}>
            Mailbox ka Sent folder check karo. Ye apne aap kabhi dobara nahi jayegi.
          </Callout>
          <ToastOnMount kind="warning" title="Is contact ka send result pakka nahi" text="Sent folder check karke upar mark karo ki mail gayi thi ya nahi." once={`manual:${id}`} />
        </>
      )}
      {l.status === "failed" && (
        <Callout tone="danger" title="Mail nahi ja payi">
          {m?.error ? <span className="block break-words">Wajah: {errText(m.error)}</span> : "Wajah neeche History mein SMTP ke jawab mein dekho."} Ye apne aap dobara nahi jayegi.
        </Callout>
      )}

      <Section title="Jaankari" icon="user" info="Is lead ki basic jaankari jo import ke waqt aayi thi: business, email, website, phone, desh, kis list se aaya aur kis campaign mein hai. Neeche ledger batata hai ki is address ko kabhi mail gayi hai ya nahi.">
        <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-4 md:grid-cols-3">
          <Row label="Business">{l.businessName || "—"}</Row>
          <Row label="Email"><span className="break-all">{l.email}</span></Row>
          <Row label="Website">
            {siteUrl
              ? <a href={siteUrl} target="_blank" rel="noreferrer" className="link break-all">{site}<Icon name="external" size={12} className="ml-1 inline-block align-[-1px]" /></a>
              : site || "—"}
          </Row>
          <Row label="Phone">{l.phone || "—"}</Row>
          <Row label="Desh">{l.country || "—"}</Row>
          <Row label="List">
            {ls?.name || "—"}
            {ls?.sourceNote && <span className="mt-0.5 block text-xs text-slate-500">Kahan se mile: {ls.sourceNote}</span>}
          </Row>
          <Row label="Campaign">{camp?.exists ? <Link href={`/campaigns/${l.campaignId}`} className="link">{cn}</Link> : cn}</Row>
          <Row label="Kab add hua">{fmt(l.createdAt)}</Row>
          <Row label="Last update">{fmt(l.updatedAt)}</Row>
          <div className="mt-3 flex min-w-0 items-start gap-3 rounded-lg border border-slate-200/70 bg-slate-50/70 px-3 py-2.5 sm:col-span-2 sm:mt-0 md:col-span-3">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${lg ? "bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-600/10" : "bg-slate-100 text-slate-400"}`}><Icon name="shield" size={16} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                Contacted Ledger
                <Info size={12} title="Contacted Ledger" text="Ledger ek permanent list hai. Jis address ko ek baar mail gayi (ya bhejne ki koshish hui), wo yahan hamesha ke liye likha jata hai, aur use dobara kabhi cold mail nahi jaati." />
              </div>
              {lg ? (
                <>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-800"><Badge v={lg.status} /><span>pehli baar {fmt(lg.at)}</span></div>
                  <div className="mt-0.5 text-xs text-slate-500">{ledgerNote(lg.status, l.status === "check_manual")}</div>
                </>
              ) : <div className="mt-0.5 text-sm text-slate-800">Abhi contact nahi hua</div>}
            </div>
          </div>
        </div>
      </Section>

      {l.facts && (
        <Section title="Homepage facts" icon="globe" sub={`Check kiya: ${fmt(l.factsAt)}`}
          info="Homepage ki technical baatein: title, description, HTTPS, mobile pe theek dikhti hai ya nahi, load time, menu/booking/order link, footer ka saal. AI inhi se mail personal banata hai.">
          <div className="flex flex-wrap gap-1.5">
            {facts.map((f, j) => <span key={j} className="max-w-full break-words rounded-md bg-slate-50 px-2 py-0.5 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">{f}</span>)}
          </div>
          <details className="group mt-3">
            <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-xs font-medium text-slate-400 transition hover:text-slate-700">
              <Icon name="chevron-right" size={13} className="transition group-open:rotate-90" />Technical detail
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200/70 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700">{pretty(l.facts)}</pre>
          </details>
        </Section>
      )}

      <Section title="Mail" icon="mail"
        actions={m ? (
          <>
            <Badge v={m.status} />
            {m.status === "ready" && m.approved === false && <Badge v="approval" label="Approval baaki" tone="amber" dot={false} />}
            {m.status === "ready" && m.approved === true && <Badge v="approved" label="Approve ho gayi" tone="emerald" dot={false} />}
            {m.dryRunDone && <Badge v="dry-run" label="Dry-run mein gayi" dot={false} />}
          </>
        ) : undefined}
        sub={m ? `Bhasha: ${m.language || "—"} · ${m.sentAt ? `Bheji gayi: ${fmt(m.sentAt)}` : m.status === "retry" && m.nextAttemptAt ? `Agli koshish: ${fmt(m.nextAttemptAt)}` : "Abhi bheji nahi gayi"}` : undefined}
        info="Is lead ke liye AI ki likhi mail. Har lead ko sirf ek hi mail jaati hai. 'Approval baaki' = Approve page pe aapka intezaar; 'Approve ho gayi' = sending window mein apne aap jayegi. English translation sirf aapke padhne ke liye hai, lead ko original bhasha wali mail hi jaati hai.">
        {m ? (
          <div className={`grid gap-4 ${m.bodyEn ? "md:grid-cols-2" : ""}`}>
            <MailPreview label="Mail ka text" subject={m.subject} text={m.body}
              footer={m.error && !wentOut
                ? <div className="break-words border-t border-red-100 bg-red-50/60 px-3 py-2 text-xs text-red-700"><span className="font-semibold">Wajah:</span> {errText(m.error)}</div>
                : m.smtpResponse ? <div className="break-words border-t border-slate-100 bg-slate-50/70 px-3 py-2 text-xs text-slate-500"><span className="font-medium">Server ka jawab:</span> <span className="font-mono">{m.smtpResponse}</span></div> : undefined} />
            {m.bodyEn && <MailPreview label="English translation" tone="translation" subject={m.subjectEn || undefined} text={m.bodyEn} />}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Is contact ke liye abhi mail nahi bani. Campaign chalne pe AI iski mail likhega aur wo Approve page pe aayegi.</p>
        )}
      </Section>

      {(replies.length > 0 || mailed) && (
        <Section title="Aaye hue jawab" icon="inbox" sub={replies.length ? `${replies.length} mail aayi` : undefined}
          info="Is lead se aayi mails: reply, opt-out, bounce ya auto-reply. Inbox har 10 minute mein apne aap sync hota hai. Opt-out aur bounce wale address apne aap block list mein chale jaate hain.">
          {replies.length ? (
            <div className="divide-y divide-slate-100">
              {replies.map((r) => (
                <div key={r.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <Badge v={r.kind} />
                    <span className="break-all font-medium text-slate-700">{r.fromEmail}</span>
                    <span className="text-slate-400">{fmt(r.receivedAt)}</span>
                  </div>
                  <div className={`grid gap-4 ${r.bodyEn ? "md:grid-cols-2" : ""}`}>
                    <MailPreview label={isBounce(r.kind) ? "Bounce report (mail server ka jawab)" : "Unka jawab"} subject={r.subject ?? ""} text={r.body.slice(0, 3000)} />
                    {r.bodyEn && <MailPreview label="English translation" tone="translation" text={r.bodyEn} />}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Abhi koi jawab nahi aaya. Reply aate hi yahan aur Replies page pe dikhega.</p>
          )}
        </Section>
      )}

      <Section title="History" icon="history" sub="Is contact ke saath kya-kya hua, purane se naye ki taraf"
        info="Har step ka record: draft kab bana, kisne approve kiya, SMTP server ne kya jawab diya, reply ya bounce kab aaya. Koi problem ho to wajah yahin milegi.">
        {items.length ? (
          <ol>
            {items.map((it, i) => (
              <li key={it.k} className="relative flex gap-3 pb-5 last:pb-0">
                {i < items.length - 1 && <span className="absolute bottom-0 left-[13px] top-7 w-px bg-slate-200" aria-hidden="true" />}
                <span className={`relative grid h-7 w-7 shrink-0 place-items-center rounded-full ring-4 ring-white ${DOT[it.tone]}`}><Icon name={it.icon} size={13} /></span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-slate-900">{it.label}</span>
                    {it.badge}
                    <span className="text-xs text-slate-400">{fmt(it.at)}</span>
                  </div>
                  {(it.note || it.server) && (
                    <div className="mt-1 space-y-0.5 break-words text-xs leading-relaxed text-slate-500">
                      {it.note && <p>{it.note}</p>}
                      {it.server && <p><span className="font-medium text-slate-600">Server ka jawab:</span> <span className="font-mono">{it.server}</span></p>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-500">Abhi koi history nahi. Draft banne, approve hone ya mail jaane pe yahan record aayega.</p>
        )}
      </Section>

      <NextStep {...nextFor(l, m, campHref)} />
    </div>
  );
}
