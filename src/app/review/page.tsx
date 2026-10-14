import Link from "next/link";
import { C, rows, type Message, type Lead, type LeadList } from "@/lib/fsdb";
import { getSettings } from "@/lib/settings";
import { fullText } from "@/lib/compose";
import { LOGO_HEIGHT, LOGO_PNG_BASE64, LOGO_WIDTH } from "@/lib/logo";
import type { Facts } from "@/lib/facts";
import { ActionButton } from "@/components/ActionButton";
import { approveMessage, approveAllShown, rejectMessage, regenerateDraft } from "../actions";
import { DraftEditor } from "./DraftEditor";

/** The facts the AI was allowed to use, so I can check the observation is true before approving. */
function factLine(f: Facts | null) {
  if (!f) return "Homepage not checked yet";
  if (!f.hasWebsite) return "No website listed";
  if (f.blockedByRobots) return "Website not checked (robots.txt)";
  const bits = [
    f.title && `title "${f.title}"`,
    f.https === false && "no HTTPS",
    f.mobileViewport === false && "no mobile viewport",
    f.bookingLink === false && "no booking link",
    f.orderLink === false && "no order link",
    f.footerYear && `footer year ${f.footerYear}`,
    f.error && `load error: ${f.error}`,
  ].filter(Boolean);
  return bits.join(" · ") || "No notable facts";
}

export default async function Review() {
  const s = await getSettings();
  const pending = rows<Message>(await C.messages.where("approved", "==", false).where("status", "==", "ready").orderBy("createdAt").limit(50).get());
  const leads = new Map<string, Lead>();
  const lists = new Map<string, LeadList>();
  for (const m of pending) {
    const l = await C.leads.doc(m.leadId).get();
    if (!l.exists) continue;
    const lead = { id: l.id, ...l.data() } as Lead;
    leads.set(m.leadId, lead);
    if (!lists.has(lead.listId)) lists.set(lead.listId, (await C.lists.doc(lead.listId).get()).data() as LeadList);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1 mb-0">Approve mails</h1>
        <span className="text-sm text-slate-500">{pending.length} waiting · {s.dryRun ? "DRY-RUN: approved mails go to your test address" : "LIVE: approved mails go to the lead"}</span>
        {pending.length > 1 && (
          <span className="ml-auto">
            <ActionButton action={approveAllShown.bind(null, pending.map((m) => m.id))} label={`Approve all ${pending.length}`} confirmText={`Click again: approve all ${pending.length} mails`} />
          </span>
        )}
      </div>
      {!s.approveEach && <div className="card text-sm text-amber-700">&quot;Approve every mail&quot; is off in Settings: new drafts are approved automatically.</div>}
      <p className="text-sm text-slate-500">Nothing on this page has been sent. A mail can only go out after you approve it, and only inside the sending window. Reject means this lead is never emailed.</p>

      {pending.map((m) => {
        const lead = leads.get(m.leadId);
        const list = lead ? lists.get(lead.listId) : undefined;
        const facts = lead?.facts ? (JSON.parse(lead.facts) as Facts) : null;
        return (
          <div key={m.id} className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Link href={`/contacts/${encodeURIComponent(m.leadId)}`} className="font-medium text-indigo-600">{m.businessName || m.leadEmail}</Link>
              <span className="text-slate-500">{m.leadEmail}</span>
              {lead?.website && <span className="text-slate-500">{lead.website}</span>}
              <span className="badge">{m.language.toUpperCase()}</span>
              {(m as Message & { edited?: boolean }).edited && <span className="badge bg-amber-100 text-amber-800">edited by you</span>}
            </div>
            <div className="text-xs text-slate-500">Facts the AI could use: {factLine(facts)}</div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-500">Subject</div>
                <div className="font-medium mb-2">{m.subject}</div>
                <pre className="whitespace-pre-wrap text-sm font-sans bg-slate-50 p-3 rounded">{fullText(s, m.body, m.language, list?.sourceNote || "")}</pre>
                {s.signatureLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`data:image/png;base64,${LOGO_PNG_BASE64}`} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="Logo shown in the signature" className="mt-2 border border-slate-200 rounded" />
                )}
              </div>
              {m.bodyEn ? (
                <div>
                  <div className="text-xs text-slate-500">English translation</div>
                  <div className="font-medium mb-2">{m.subjectEn}</div>
                  <pre className="whitespace-pre-wrap text-sm font-sans bg-indigo-50/50 p-3 rounded">{m.bodyEn}</pre>
                </div>
              ) : m.language !== "en" ? <div className="text-xs text-slate-500">No translation (edited by hand).</div> : null}
            </div>
            <div className="flex flex-wrap gap-3 items-start">
              <ActionButton action={approveMessage.bind(null, m.id)} label="✓ Approve" className="btn-primary" />
              <ActionButton action={regenerateDraft.bind(null, m.id)} label="Write a new version" />
              <ActionButton action={rejectMessage.bind(null, m.id)} label="Reject (never email this lead)" confirmText="Click again to reject" />
            </div>
            <DraftEditor id={m.id} subject={m.subject} body={m.body} />
          </div>
        );
      })}
      {!pending.length && <div className="card text-sm text-slate-500">No mails waiting. New drafts appear here while a campaign is running.</div>}
    </div>
  );
}
