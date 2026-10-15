import Link from "next/link";
import { C, rows, type Campaign, type Message, type Lead, type LeadList } from "@/lib/fsdb";
import { getSettings } from "@/lib/settings";
import { fullText } from "@/lib/compose";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { knowsWhatTheyDo } from "@/lib/leadinfo";
import { LOGO_HEIGHT, LOGO_PNG_BASE64, LOGO_WIDTH } from "@/lib/logo";
import { isTemplateId, templateOf } from "@/lib/templates";
import { ActionButton } from "@/components/ActionButton";
import { knownItems, parseFacts, siteNote } from "@/components/factChips";
import { Info } from "@/components/Info";
import { Icon } from "@/components/icons";
import { ToastOnMount } from "@/components/toast";
import { Badge, Callout, EmptyState, MailPreview, NextStep, PageHeader } from "@/components/ui";
import { approveMessage, approveAllShown, rejectMessage, regenerateDraft } from "../actions";
import { DraftEditor } from "./DraftEditor";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Approve karo", "Approve mails") };
}

/**
 * The worker only sends mails of a running campaign whose samples were approved (trySendOne in lib/sender.ts).
 * For any other campaign, approving here alone sends nothing: the card says why.
 */
function campaignHold(c: Campaign | null, t: T): { title: string; text: string } | null {
  if (!c) return { title: t("Is mail ka campaign nahi mila", "This mail's campaign was not found"), text: t("Approve karne pe bhi ye mail nahi jayegi.", "Even if you approve it, this mail will not be sent.") };
  if (!c.samplesApproved) {
    return {
      title: t("Campaign abhi start nahi hua", "The campaign has not started yet"),
      text: t(
        "Sirf approve karne se ye mail nahi jayegi. Campaign page pe samples padho aur ‘Samples theek hain: approve karke start karo’ dabao.",
        "Approving alone will not send this mail. Read the samples on the Campaign page and press ‘Samples look good: approve and start’.",
      ),
    };
  }
  if (c.status === "paused") return { title: t("Campaign ruka hua hai", "The campaign is paused"), text: t("Approve ki hui mail tabhi jayegi jab Campaign page pe ‘Resume karo’ dabaoge.", "An approved mail goes out only after you press ‘Resume’ on the Campaign page.") };
  if (c.status === "done") return { title: t("Campaign poora ho chuka hai", "The campaign has already finished"), text: t("Approve karne pe bhi ye mail nahi jayegi.", "Even if you approve it, this mail will not be sent.") };
  if (c.status !== "running") return { title: t("Campaign chal nahi raha", "The campaign is not running"), text: t("Approve karne pe bhi ye mail nahi jayegi.", "Even if you approve it, this mail will not be sent.") };
  return null;
}

/** Phones: long labels (e.g. the armed Reject text) wrap inside the button instead of overflowing the 2-column grid. */
const WRAP = "max-sm:h-auto max-sm:min-h-9 max-sm:whitespace-normal max-sm:py-1.5 max-sm:text-center max-sm:leading-tight";

export default async function Review() {
  const { t, lang } = await getT();
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
  const holdOf = (m: Message) => (m.campaignId ? campaignHold(campaigns.get(m.campaignId) ?? null, t) : null);
  const held = pending.filter((m) => holdOf(m));
  // the campaigns behind the held mails that can be opened (one → link straight to it)
  const heldCampaigns = [...new Set(held.map((m) => m.campaignId))].filter((id) => campaigns.get(id));
  const sentHref = s.dryRun ? "/sent?mode=dry" : "/sent";
  const sendLine = s.dryRun
    ? t(
      "Approve ki hui mails sending window mein ek-ek karke aapke test address pe jayengi; wo Sent page ke Dry-run tab mein dikhengi.",
      "Approved mails go to your test address one by one in the sending window; they show up in the Dry-run tab of the Sent page.",
    )
    : t(
      "Approve ki hui mails sending window mein ek-ek karke jayengi. Kya gaya, wo Sent page pe dikhega.",
      "Approved mails go out one by one in the sending window. What was sent shows up on the Sent page.",
    );
  const info = t(
    `Har nayi mail (AI ki likhi ya template se bani) yahan rukti hai: aapke approve kiye bina koi mail nahi jaati.
Approve karo = mail sending window mein jayegi (jab uska campaign chal raha ho). Naya version = AI dobara likhega (template wali mail template se dobara banegi).
Reject karo = is lead ko kabhi mail nahi jayegi. Edit = text khud badlo, same rules check honge.
DRY-RUN mein approve ki hui mail test address pe jaati hai. Approval yaad rehta hai: LIVE on karne ke baad wahi mail asli lead ko bhi jayegi.`,
    `Every new mail (written by the AI or made from a template) waits here: no mail goes out without your approval.
Approve = the mail goes out in the sending window (while its campaign is running). New version = the AI writes it again (a template mail is made again from its template).
Reject = this lead will never be emailed. Edit = change the text yourself; the same rules are checked.
In DRY-RUN an approved mail goes to your test address. The approval is kept: once LIVE is on, the same mail also goes to the real lead.`,
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Mails approve karo", "Approve mails")}
        info={info}
        sub={n
          ? t(
            `${n} ${n === 1 ? "mail aapke approval ka wait kar rahi hai" : "mails aapke approval ka wait kar rahi hain"}${n === 50 ? " (pehli 50 dikh rahi hain)" : ""}`,
            `${n} ${n === 1 ? "mail is waiting for your approval" : "mails are waiting for your approval"}${n === 50 ? " (showing the first 50)" : ""}`,
          )
          : t("Abhi koi mail aapke approval ka wait nahi kar rahi", "No mails are waiting for your approval right now")}
        actions={n > 1 && (
          <ActionButton action={approveAllShown.bind(null, pending.map((m) => m.id))} label={t(`Sab ${n} approve karo`, `Approve all ${n}`)} icon="check-check" className="btn w-full sm:w-auto"
            confirmText={t(`Dobara dabao: sab ${n} mails approve hongi`, `Click again: approve all ${n} mails`)} next="/sent" nextCta={t("Sent page dekho", "See sent mails")} />
        )}
      />

      {s.dryRun ? (
        <Callout tone={s.testEmail ? "warn" : "danger"} title="DRY-RUN mode" action={s.testEmail
          ? <Link href="/#mode" className="btn btn-sm">{t("Mode dekho", "See mode")}</Link>
          : <Link href="/settings" className="btn btn-sm">{t("Settings kholo", "Open settings")}</Link>}>
          {s.testEmail
            ? t(
              `Abhi approve ki hui mails sirf aapke test address (${s.testEmail}) pe jayengi. Dhyan do: approval yaad rehta hai, LIVE on karne ke baad yahi mails bina dobara pooche asli leads ko jayengi. Sirf wahi approve karo jo sach mein lead ko bhejni hai.`,
              `For now, approved mails go only to your test address (${s.testEmail}). Note: the approval is kept; once LIVE is on, these same mails go to the real leads without asking again. Only approve what you really want to send to the lead.`,
            )
            : t(
              "Approve ki hui mails sirf test address pe jayengi, lekin Settings mein Test address abhi set nahi hai. Dhyan do: approval yaad rehta hai, LIVE on karne ke baad yahi mails bina dobara pooche asli leads ko jayengi.",
              "Approved mails go only to the test address, but no Test address is set in Settings yet. Note: the approval is kept; once LIVE is on, these same mails go to the real leads without asking again.",
            )}
        </Callout>
      ) : (
        <Callout tone="info" title="LIVE mode">{t("Approve ki hui mails asli leads ko jayengi. Approve karne se pehle har mail dhyan se padho.", "Approved mails go to the real leads. Read every mail carefully before you approve it.")}</Callout>
      )}
      {!s.approveEach && (
        <Callout tone="warn" title={t("Auto-approve on hai", "Auto-approve is on")} action={<Link href="/settings" className="btn btn-sm">{t("Settings kholo", "Open settings")}</Link>}>
          {t(
            <>Settings mein &quot;Har mail approve karke hi bhejo&quot; off hai, isliye nayi drafts apne aap approve ho jaati hain.</>,
            <>&quot;Approve every mail before sending&quot; is off in Settings, so new drafts are approved automatically.</>,
          )}
        </Callout>
      )}
      {s.dryRun && !s.testEmail && (
        <ToastOnMount kind="warning" title={t("Test address set nahi hai", "No test address set")}
          text={t("DRY-RUN mein approve ki hui mails test address pe jaati hain. Settings mein Test address daalo.", "In DRY-RUN, approved mails go to the test address. Add a Test address in Settings.")}
          href="/settings" cta={t("Settings kholo", "Open settings")} once="review:no-test-address" />
      )}

      {pending.map((m, i) => {
        const lead = leads.get(m.leadId);
        const list = lead ? lists.get(lead.listId) : undefined;
        const camp = m.campaignId ? campaigns.get(m.campaignId) : undefined;
        const hold = holdOf(m);
        // a template campaign fills a fixed text (no AI, so no AI facts); an AI campaign gets only the known facts
        const tpl = camp && isTemplateId(camp.mailType) ? templateOf(s, camp.mailType) : null;
        const tplName = tpl ? (tpl.name || "").trim() || `Template ${tpl.id.slice(3)}` : "";
        const facts = parseFacts(lead?.facts);
        const known = lead ? knownItems(lead, facts, lang) : [];
        const site = lead ? siteNote(lead.website, facts, lang) : null;
        const guessed = !!lead && !knowsWhatTheyDo(known);
        const name = m.businessName || m.leadEmail;
        const edited = (m as Message & { edited?: boolean }).edited;
        const translation = m.bodyEn ? (
          <MailPreview label="English translation" subject={m.subjectEn || undefined} text={m.bodyEn} tone="translation"
            footer={(
              <div className="flex items-start gap-1.5 border-t border-indigo-100 px-3 py-2 text-2xs leading-relaxed text-slate-500">
                <Icon name="info" size={12} className="mt-px shrink-0 text-indigo-400" />
                {t(
                  <>Sirf aapke padhne ke liye. Lead ko ye nahi jaata, use sirf &quot;Mail (jaisi jayegi)&quot; wala text jaata hai.</>,
                  <>Only for you to read. The lead does not get this; they only get the &quot;Mail (as it will be sent)&quot; text.</>,
                )}
              </div>
            )} />
        ) : m.language !== "en" ? (
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400"><Icon name="globe" size={12} />English translation</div>
            <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500">{t("Translation nahi hai, kyunki ye text aapne khud edit kiya hai.", "No translation, because you edited this text yourself.")}</div>
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
                  {edited && <Badge v="edited" label={t("Aapne edit kiya", "Edited by you")} tone="amber" />}
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
                <span className="text-2xs font-medium tabular-nums text-slate-400" title={t(`${n} mein se mail number ${i + 1}`, `Mail ${i + 1} of ${n}`)}>{i + 1}/{n}</span>
                <Info title={t("Ye card kya hai", "About this card")} size={13}
                  text={tpl
                    ? t(
                      "Is lead ke liye template se bani draft. Naam pe click karo to contact ki poori history khulegi, campaign ke naam pe click karo to campaign ka page. Mail padho, phir neeche se Approve, Edit, Naya version ya Reject karo.",
                      "The draft made from a template for this lead. Click the name to open the contact's full history, or the campaign name to open the campaign page. Read the mail, then choose Approve, Edit, New version or Reject below.",
                    )
                    : t(
                      "Is lead ke liye AI ki likhi draft. Naam pe click karo to contact ki poori history khulegi, campaign ke naam pe click karo to campaign ka page. ‘AI ko ye pata tha’ wali list aur mail padho, phir neeche se Approve, Edit, Naya version ya Reject karo.",
                      "The draft the AI wrote for this lead. Click the name to open the contact's full history, or the campaign name to open the campaign page. Read the ‘What the AI knew’ list and the mail, then choose Approve, Edit, New version or Reject below.",
                    )} />
              </div>
            </header>

            <div className="space-y-4 p-4 sm:p-5">
              {hold && (
                <Callout tone="warn" title={hold.title}
                  action={camp && <Link href={`/campaigns/${camp.id}`} className="btn btn-sm">{t("Campaign kholo", "Open campaign")}</Link>}>
                  {hold.text}
                </Callout>
              )}
              {tpl ? (
                <div className="flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                  <Icon name="file" size={13} className="mt-px shrink-0 text-slate-400" />
                  <span className="min-w-0 break-words">{t("Template se bani:", "Written from template:")} <span className="font-medium text-slate-800">{tplName}</span></span>
                  <Info title={t("Template se bani mail", "A mail made from a template")} size={13}
                    text={t(
                      "Is campaign mein AI mail nahi likhta: ye mail Settings ke ‘Email templates’ wale fixed template se bani hai. {{business}}, {{contact}} jaise placeholders lead ki jaankari se bhare gaye; jo jaankari nahi thi, wahan template ka default text aaya. Padh ke Approve, Edit ya Reject karo.",
                      "In this campaign the AI does not write the mails: this mail was made from a fixed template in Settings → ‘Email templates’. Placeholders like {{business}} and {{contact}} were filled from the lead's details; where a detail was missing, the template's default text was used. Read it, then Approve, Edit or Reject.",
                    )} />
                </div>
              ) : (
                <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <Icon name="bot" size={13} className="text-slate-400" />{t("AI ko ye pata tha", "What the AI knew")}
                    <Info title={t("AI ko ye pata tha", "What the AI knew")} size={13}
                      text={t(
                        "Mail likhte waqt AI ko is lead ke baare mein sirf yahi baatein di gayi thi, aur wo sirf inhi ka use kar sakta hai. Website ka title / description sirf ye samajhne ke liye hai ki business kya karta hai: AI kabhi website pe comment nahi karta (jaise ‘maine aapka homepage dekha’). Agar mail mein koi aisi baat hai jo is list mein nahi hai, to use Edit karo ya Reject karo.",
                        "When writing the mail, the AI was given only these points about this lead, and it may use only them. The website title / description is only there to understand what the business does: the AI never comments on the website (like ‘I saw your homepage’). If the mail says anything that is not in this list, Edit or Reject it.",
                      )} />
                  </div>
                  {known.length ? (
                    <dl className="mt-2 grid gap-y-2 text-xs sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-1">
                      {known.map((k) => (
                        <div key={k.key} className="min-w-0 sm:contents">
                          <dt className="text-slate-500 sm:whitespace-nowrap">{k.label}</dt>
                          <dd className="min-w-0 break-words text-slate-800">{k.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="mt-2 text-xs text-slate-700">
                      {lead
                        ? t("Email address ke siwa is lead ke baare mein kuch nahi pata tha.", "Nothing was known about this lead except the email address.")
                        : t("Is mail ka lead nahi mila.", "This mail's lead was not found.")}
                    </p>
                  )}
                  {(site || guessed) && (
                    <div className="mt-2 space-y-1 border-t border-slate-200/70 pt-2 text-xs">
                      {site && <p className="flex items-start gap-1.5 text-slate-500"><Icon name="globe" size={12} className="mt-0.5 shrink-0 text-slate-400" /><span className="min-w-0 break-words">{site}</span></p>}
                      {guessed && (
                        <p className="flex items-start gap-1.5 text-amber-700">
                          <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
                          <span className="min-w-0">{t(
                            "AI ko nahi pata tha ki ye business kya karta hai: mail mein unke kaam ke baare mein koi baat nahi honi chahiye.",
                            "The AI did not know what this business does: the mail must not say anything about their work.",
                          )}</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className={translation ? "grid gap-4 md:grid-cols-2" : "max-w-2xl"}>
                <MailPreview label={t("Mail (jaisi jayegi)", "Mail (as it will be sent)")} subject={m.subject} text={fullText(s, m.body, m.language, list?.sourceNote || "")}
                  footer={s.signatureLogo ? (
                    <div className="border-t border-slate-100 px-3 py-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`data:image/png;base64,${LOGO_PNG_BASE64}`} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt={t("Signature ka logo", "Signature logo")} className="h-auto max-w-full" />
                      <div className="mt-1 text-2xs text-slate-400">{t("Ye logo signature ke saath mail mein judta hai", "This logo is added to the mail with the signature")}</div>
                    </div>
                  ) : undefined} />
                {translation}
              </div>
            </div>

            {/* phones: Approve full width, then Edit + New version, then Reject; DraftEditor's form always goes last */}
            <footer className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:flex sm:flex-wrap sm:items-center sm:px-5">
              <ActionButton action={approveMessage.bind(null, m.id)} label={t("Approve karo", "Approve")} icon="check" className={`btn-success col-span-2 ${WRAP}`} />
              <DraftEditor id={m.id} subject={m.subject} body={m.body} language={m.language} businessName={m.businessName || ""} />
              <ActionButton action={regenerateDraft.bind(null, m.id)} label={t("Naya version likho", "Write a new version")} icon="refresh"
                pendingText={tpl ? t("Template se ban rahi hai…", "Filling the template…") : t("AI likh raha hai…", "AI is writing…")} className={`btn ${WRAP}`} />
              <ActionButton action={rejectMessage.bind(null, m.id)} label={t("Reject karo", "Reject")} icon="x" confirmText={t("Dobara dabao: ye lead kabhi mail nahi paayega", "Click again: this lead will never be emailed")}
                className={`btn col-span-2 text-red-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 sm:ml-auto ${WRAP}`} />
            </footer>
          </article>
        );
      })}

      {n > 0 && held.length === n ? (
        <NextStep tone="amber"
          text={t(
            "In mails ka campaign abhi chal nahi raha, isliye approve karne pe bhi ye abhi nahi jayengi. Campaign page pe samples padh ke campaign start karo, ya ruka hua campaign Resume karo.",
            "The campaign for these mails is not running right now, so they will not go out yet, even if you approve them. Read the samples on the Campaign page and start the campaign, or resume a paused campaign.",
          )}
          href={heldCampaigns.length === 1 ? `/campaigns/${heldCampaigns[0]}` : "/campaigns"}
          cta={heldCampaigns.length === 1 ? t("Campaign kholo", "Open campaign") : t("Campaigns dekho", "See campaigns")} />
      ) : n > 0 ? (
        <NextStep
          text={held.length
            ? t(`${sendLine} Jis card pe campaign ki warning hai, wo mail campaign chalne tak nahi jayegi.`, `${sendLine} A mail whose card shows a campaign warning will not go out until its campaign runs.`)
            : sendLine}
          href={sentHref} cta={s.dryRun ? t("Dry-run mails dekho", "See dry-run mails") : t("Sent page dekho", "See sent mails")} />
      ) : (
        <>
          {/* one primary action per screen: the NextStep below; the empty card only offers a secondary link */}
          <div className="card">
            <EmptyState icon="check-check" title={t("Koi mail approval ke liye nahi ruki", "No mails are waiting for approval")}
              text={s.approveEach
                ? t("Campaign chal raha ho to worker nayi drafts banata rahega; wo yahan aayengi.", "While a campaign is running, the worker keeps writing new drafts; they will show up here.")
                : t("Auto-approve on hai, isliye nayi drafts yahan nahi rukengi: wo seedhe sending window mein jaati hain.", "Auto-approve is on, so new drafts do not wait here: they go straight to the sending window.")}>
              {s.approveEach && <Link href="/campaigns" className="btn mt-4">{t("Campaigns dekho", "See campaigns")}<Icon name="arrow-right" size={14} /></Link>}
            </EmptyState>
          </div>
          <NextStep
            text={t(
              "Ab tak kaunsi mail kab aur kisko gayi, wo Sent page pe dekho. Nayi drafts chahiye to Campaigns mein campaign chalao.",
              "See on the Sent page which mails went out so far, when and to whom. Need new drafts? Run a campaign in Campaigns.",
            )}
            href={sentHref} cta={t("Bheji gayi mails dekho", "See sent mails")} />
        </>
      )}
    </div>
  );
}
