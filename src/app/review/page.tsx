import Link from "next/link";
import { C, rows, type Campaign, type Message, type Lead, type LeadList } from "@/lib/fsdb";
import { getSettings } from "@/lib/settings";
import { fullText } from "@/lib/compose";
import { LOGO_HEIGHT, LOGO_PNG_BASE64, LOGO_WIDTH } from "@/lib/logo";
import { ActionButton } from "@/components/ActionButton";
import { factChips, parseFacts } from "@/components/factChips";
import { Info } from "@/components/Info";
import { Icon } from "@/components/icons";
import { ToastOnMount } from "@/components/toast";
import { Badge, Callout, EmptyState, MailPreview, NextStep, PageHeader } from "@/components/ui";
import { approveMessage, approveAllShown, rejectMessage, regenerateDraft } from "../actions";
import { DraftEditor } from "./DraftEditor";

export const metadata = { title: "Approve karo" };

/**
 * The worker only sends mails of a running campaign whose samples were approved (trySendOne in lib/sender.ts).
 * For any other campaign, approving here alone sends nothing: the card says why.
 */
function campaignHold(c: Campaign | null): { title: string; text: string } | null {
  if (!c) return { title: "Is mail ka campaign nahi mila", text: "Approve karne pe bhi ye mail nahi jayegi." };
  if (!c.samplesApproved) {
    return { title: "Campaign abhi start nahi hua", text: "Sirf approve karne se ye mail nahi jayegi. Campaign page pe samples padho aur ‘Samples theek hain: approve karke start karo’ dabao." };
  }
  if (c.status === "paused") return { title: "Campaign ruka hua hai", text: "Approve ki hui mail tabhi jayegi jab Campaign page pe ‘Resume karo’ dabaoge." };
  if (c.status === "done") return { title: "Campaign poora ho chuka hai", text: "Approve karne pe bhi ye mail nahi jayegi." };
  if (c.status !== "running") return { title: "Campaign chal nahi raha", text: "Approve karne pe bhi ye mail nahi jayegi." };
  return null;
}

/** Phones: long labels (e.g. the armed Reject text) wrap inside the button instead of overflowing the 2-column grid. */
const WRAP = "max-sm:h-auto max-sm:min-h-9 max-sm:whitespace-normal max-sm:py-1.5 max-sm:text-center max-sm:leading-tight";

const INFO = `AI ki likhi har mail yahan rukti hai: aapke approve kiye bina koi mail nahi jaati.
Approve karo = mail sending window mein jayegi (jab uska campaign chal raha ho). Naya version = AI dobara likhega.
Reject karo = is lead ko kabhi mail nahi jayegi. Edit = text khud badlo, same rules check honge.
DRY-RUN mein approve ki hui mail test address pe jaati hai. Approval yaad rehta hai: LIVE on karne ke baad wahi mail asli lead ko bhi jayegi.`;

export default async function Review() {
  const s = await getSettings();
  const pending = rows<Message>(await C.messages.where("approved", "==", false).where("status", "==", "ready").orderBy("createdAt").limit(50).get());
  const leads = new Map<string, Lead>();
  const lists = new Map<string, LeadList>();
  const campaigns = new Map<string, Campaign | null>();
  for (const m of pending) {
    if (m.campaignId && !campaigns.has(m.campaignId)) {
      const c = await C.campaigns.doc(m.campaignId).get();
      campaigns.set(m.campaignId, c.exists ? ({ id: c.id, ...c.data() } as Campaign) : null);
    }
    const l = await C.leads.doc(m.leadId).get();
    if (!l.exists) continue;
    const lead = { id: l.id, ...l.data() } as Lead;
    leads.set(m.leadId, lead);
    if (!lists.has(lead.listId)) lists.set(lead.listId, (await C.lists.doc(lead.listId).get()).data() as LeadList);
  }
  const n = pending.length;
  const holdOf = (m: Message) => (m.campaignId ? campaignHold(campaigns.get(m.campaignId) ?? null) : null);
  const held = pending.filter((m) => holdOf(m));
  // the campaigns behind the held mails that can be opened (one → link straight to it)
  const heldCampaigns = [...new Set(held.map((m) => m.campaignId))].filter((id) => campaigns.get(id));
  const sentHref = s.dryRun ? "/sent?mode=dry" : "/sent";
  const sendLine = s.dryRun
    ? "Approve ki hui mails sending window mein ek-ek karke aapke test address pe jayengi; wo Sent page ke Dry-run tab mein dikhengi."
    : "Approve ki hui mails sending window mein ek-ek karke jayengi. Kya gaya, wo Sent page pe dikhega.";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mails approve karo"
        info={INFO}
        sub={n
          ? `${n} ${n === 1 ? "mail aapke approval ka wait kar rahi hai" : "mails aapke approval ka wait kar rahi hain"}${n === 50 ? " (pehli 50 dikh rahi hain)" : ""}`
          : "Abhi koi mail aapke approval ka wait nahi kar rahi"}
        actions={n > 1 && (
          <ActionButton action={approveAllShown.bind(null, pending.map((m) => m.id))} label={`Sab ${n} approve karo`} icon="check-check" className="btn w-full sm:w-auto"
            confirmText={`Dobara dabao: sab ${n} mails approve hongi`} next="/sent" nextCta="Sent page dekho" />
        )}
      />

      {s.dryRun ? (
        <Callout tone={s.testEmail ? "warn" : "danger"} title="DRY-RUN mode" action={s.testEmail
          ? <Link href="/#mode" className="btn btn-sm">Mode dekho</Link>
          : <Link href="/settings" className="btn btn-sm">Settings kholo</Link>}>
          {s.testEmail
            ? `Abhi approve ki hui mails sirf aapke test address (${s.testEmail}) pe jayengi. Dhyan do: approval yaad rehta hai, LIVE on karne ke baad yahi mails bina dobara pooche asli leads ko jayengi. Sirf wahi approve karo jo sach mein lead ko bhejni hai.`
            : "Approve ki hui mails sirf test address pe jayengi, lekin Settings mein Test address abhi set nahi hai. Dhyan do: approval yaad rehta hai, LIVE on karne ke baad yahi mails bina dobara pooche asli leads ko jayengi."}
        </Callout>
      ) : (
        <Callout tone="info" title="LIVE mode">Approve ki hui mails asli leads ko jayengi. Approve karne se pehle har mail dhyan se padho.</Callout>
      )}
      {!s.approveEach && (
        <Callout tone="warn" title="Auto-approve on hai" action={<Link href="/settings" className="btn btn-sm">Settings kholo</Link>}>
          Settings mein &quot;Har mail approve karke hi bhejo&quot; off hai, isliye nayi drafts apne aap approve ho jaati hain.
        </Callout>
      )}
      {s.dryRun && !s.testEmail && (
        <ToastOnMount kind="warning" title="Test address set nahi hai" text="DRY-RUN mein approve ki hui mails test address pe jaati hain. Settings mein Test address daalo."
          href="/settings" cta="Settings kholo" once="review:no-test-address" />
      )}

      {pending.map((m, i) => {
        const lead = leads.get(m.leadId);
        const list = lead ? lists.get(lead.listId) : undefined;
        const camp = m.campaignId ? campaigns.get(m.campaignId) : undefined;
        const hold = holdOf(m);
        const facts = parseFacts(lead?.facts);
        const name = m.businessName || m.leadEmail;
        const edited = (m as Message & { edited?: boolean }).edited;
        const translation = m.bodyEn ? (
          <MailPreview label="English translation" subject={m.subjectEn || undefined} text={m.bodyEn} tone="translation"
            footer={(
              <div className="flex items-start gap-1.5 border-t border-indigo-100 px-3 py-2 text-2xs leading-relaxed text-slate-500">
                <Icon name="info" size={12} className="mt-px shrink-0 text-indigo-400" />
                Sirf aapke padhne ke liye. Lead ko ye nahi jaata, use sirf &quot;Mail (jaisi jayegi)&quot; wala text jaata hai.
              </div>
            )} />
        ) : m.language !== "en" ? (
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400"><Icon name="globe" size={12} />English translation</div>
            <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500">Translation nahi hai, kyunki ye text aapne khud edit kiya hai.</div>
          </div>
        ) : null;
        return (
          <article key={m.id} className="card-flush">
            <header className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-600">{(Array.from(name.trim())[0] || "?").toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={`/contacts/${encodeURIComponent(m.leadId)}`} className="min-w-0 truncate text-sm font-semibold text-slate-900 hover:text-indigo-600">{name}</Link>
                  <Badge v="language" label={m.language.toUpperCase()} tone="indigo" dot={false} />
                  {edited && <Badge v="edited" label="Aapne edit kiya" tone="amber" />}
                </div>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  <span className="inline-flex min-w-0 max-w-full items-center gap-1"><Icon name="mail" size={12} className="text-slate-400" /><span className="truncate">{m.leadEmail}</span></span>
                  {lead?.website && <span className="inline-flex min-w-0 max-w-full items-center gap-1"><Icon name="globe" size={12} className="text-slate-400" /><span className="truncate">{lead.website}</span></span>}
                  {camp && (
                    <Link href={`/campaigns/${camp.id}`} className="inline-flex min-w-0 max-w-full items-center gap-1 hover:text-indigo-600">
                      <Icon name="megaphone" size={12} className="text-slate-400" /><span className="truncate">{camp.name}</span>
                    </Link>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                <span className="text-2xs font-medium tabular-nums text-slate-400" title={`${n} mein se mail number ${i + 1}`}>{i + 1}/{n}</span>
                <Info title="Ye card kya hai" size={13} text="Is lead ke liye AI ki likhi draft. Naam pe click karo to contact ki poori history khulegi, campaign ke naam pe click karo to campaign ka page. Facts aur mail padho, phir neeche se Approve, Edit, Naya version ya Reject karo." />
              </div>
            </header>

            <div className="space-y-4 p-4 sm:p-5">
              {hold && (
                <Callout tone="warn" title={hold.title}
                  action={camp && <Link href={`/campaigns/${camp.id}`} className="btn btn-sm">Campaign kholo</Link>}>
                  {hold.text}
                </Callout>
              )}
              <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <Icon name="search" size={13} className="text-slate-400" />AI ko ye facts mile:
                  <Info title="Website ke facts" size={13} text="Homepage check karke AI ko bilkul yahi baatein di gayi thi, isse zyada kuch nahi. Mail mein website ke baare mein jo likha hai wo inse match hona chahiye; galat lage to Edit ya Reject karo." />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {factChips(facts).map((b, j) => <span key={j} className="max-w-full break-words rounded-md bg-white px-2 py-0.5 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">{b}</span>)}
                </div>
              </div>

              <div className={translation ? "grid gap-4 md:grid-cols-2" : "max-w-2xl"}>
                <MailPreview label="Mail (jaisi jayegi)" subject={m.subject} text={fullText(s, m.body, m.language, list?.sourceNote || "")}
                  footer={s.signatureLogo ? (
                    <div className="border-t border-slate-100 px-3 py-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`data:image/png;base64,${LOGO_PNG_BASE64}`} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="Signature ka logo" className="h-auto max-w-full" />
                      <div className="mt-1 text-2xs text-slate-400">Ye logo signature ke saath mail mein judta hai</div>
                    </div>
                  ) : undefined} />
                {translation}
              </div>
            </div>

            {/* phones: Approve full width, then Edit + Naya version, then Reject; DraftEditor's form always goes last */}
            <footer className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:flex sm:flex-wrap sm:items-center sm:px-5">
              <ActionButton action={approveMessage.bind(null, m.id)} label="Approve karo" icon="check" className={`btn-success col-span-2 ${WRAP}`} />
              <DraftEditor id={m.id} subject={m.subject} body={m.body} language={m.language} businessName={m.businessName || ""} />
              <ActionButton action={regenerateDraft.bind(null, m.id)} label="Naya version likho" icon="refresh" pendingText="AI likh raha hai…" className={`btn ${WRAP}`} />
              <ActionButton action={rejectMessage.bind(null, m.id)} label="Reject karo" icon="x" confirmText="Dobara dabao: ye lead kabhi mail nahi paayega"
                className={`btn col-span-2 text-red-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 sm:ml-auto ${WRAP}`} />
            </footer>
          </article>
        );
      })}

      {n > 0 && held.length === n ? (
        <NextStep tone="amber" text="In mails ka campaign abhi chal nahi raha, isliye approve karne pe bhi ye abhi nahi jayengi. Campaign page pe samples padh ke campaign start karo, ya ruka hua campaign Resume karo."
          href={heldCampaigns.length === 1 ? `/campaigns/${heldCampaigns[0]}` : "/campaigns"} cta={heldCampaigns.length === 1 ? "Campaign kholo" : "Campaigns dekho"} />
      ) : n > 0 ? (
        <NextStep text={held.length ? `${sendLine} Jis card pe campaign ki warning hai, wo mail campaign chalne tak nahi jayegi.` : sendLine}
          href={sentHref} cta={s.dryRun ? "Dry-run mails dekho" : "Sent page dekho"} />
      ) : (
        <>
          {/* one primary action per screen: the NextStep below; the empty card only offers a secondary link */}
          <div className="card">
            <EmptyState icon="check-check" title="Koi mail approval ke liye nahi ruki"
              text={s.approveEach
                ? "Campaign chal raha ho to worker nayi drafts banata rahega; wo yahan aayengi."
                : "Auto-approve on hai, isliye nayi drafts yahan nahi rukengi: wo seedhe sending window mein jaati hain."}>
              {s.approveEach && <Link href="/campaigns" className="btn mt-4">Campaigns dekho<Icon name="arrow-right" size={14} /></Link>}
            </EmptyState>
          </div>
          <NextStep text="Ab tak kaunsi mail kab aur kisko gayi, wo Sent page pe dekho. Nayi drafts chahiye to Campaigns mein campaign chalao." href={sentHref} cta="Bheji gayi mails dekho" />
        </>
      )}
    </div>
  );
}
