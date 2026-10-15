import Link from "next/link";
import type { ReactNode } from "react";
import { getSettings, getState, type Settings } from "@/lib/settings";
import { capFor } from "@/lib/schedule";
import { signature } from "@/lib/compose";
import { footer } from "@/lib/lang";
import { fmt } from "@/lib/time";
import { saveSettingsAction, testSmtpAction, testImapAction, testMailAction, testAiAction, dnsAction, syncNowAction } from "../actions";
import { ActionButton } from "@/components/ActionButton";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Info } from "@/components/Info";
import { Icon, type IconName } from "@/components/icons";
import { ToastOnMount } from "@/components/toast";
import { Badge, Callout, Field, NextStep, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "Settings" };

const DAYS = ["Som", "Mangal", "Budh", "Guru", "Shukra", "Shani", "Ravi"]; // checkbox value 1..7 = Mon..Sun
const AI_URLS = ["https://api.openai.com/v1", "https://api.groq.com/openai/v1", "https://openrouter.ai/api/v1"];
const JUMP: [string, string][] = [["check", "Test"], ["mailbox", "Mailbox"], ["profile", "Profile"], ["offer", "Offer"], ["rules", "Rules"], ["ai", "AI"], ["dns", "DNS"]];
const TEST_BTN = "btn h-auto min-h-9 w-full justify-start whitespace-normal py-2 text-left leading-tight";
const SUBHEAD = "mb-3 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400";
const CODE = "rounded bg-slate-100 px-1 font-mono text-2xs text-slate-600";
// hosts, addresses and URLs: no auto-capitalise / autocorrect on phone keyboards
const PLAIN = { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } as const;
const WARN_INPUT = "border-amber-300 bg-amber-50/40";

function Txt({ name, value, plain = false, warn = false, mode, placeholder }: { name: string; value: string; plain?: boolean; warn?: boolean; mode?: "email" | "url"; placeholder?: string }) {
  return <input name={name} defaultValue={value} inputMode={mode} placeholder={placeholder} className={`input ${warn ? WARN_INPUT : ""}`} {...(plain ? PLAIN : {})} />;
}
function Num({ name, value }: { name: string; value: number }) {
  return <input name={name} type="number" inputMode="numeric" defaultValue={value} className="input tabular-nums" />;
}
/** Hint with a "zaroori" marker while a required field is still empty. */
function req(value: string, hint: string): ReactNode {
  return value ? hint : <><span className="font-semibold text-amber-600">Zaroori, abhi khaali hai.</span> {hint}</>;
}
/** "A", "A aur B", "A, B aur C" */
const andList = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} aur ${xs[xs.length - 1]}` : xs[0] || "");

/**
 * On/off row. The whole row is one label (an overlay under the text) that toggles the real checkbox (same name);
 * the track and knob follow the checkbox as peers. The (i) sits outside that label with a 44px dead zone around it,
 * so a tap that just misses the (i) does nothing instead of flipping the setting.
 */
function Toggle({ name, checked, title, text, info }: { name: string; checked: boolean; title: string; text: ReactNode; info: string }) {
  return (
    <div className="relative flex select-none items-center rounded-lg border border-slate-200 bg-white py-2.5 pl-3 pr-16 transition hover:border-slate-300 hover:bg-slate-50/60">
      <label className="absolute inset-0 cursor-pointer rounded-lg">
        <input type="checkbox" name={name} defaultChecked={checked} aria-labelledby={`${name}-title`} aria-describedby={`${name}-text`} className="peer sr-only" />
        <span aria-hidden className="absolute right-3 top-1/2 h-5 w-9 -translate-y-1/2 rounded-full bg-slate-300 transition-colors peer-checked:bg-indigo-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 peer-focus-visible:ring-offset-2" />
        <span aria-hidden className="pointer-events-none absolute right-[30px] top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow-sm ring-1 ring-slate-900/5 transition-transform peer-checked:translate-x-4" />
      </label>
      {/* taps on the text fall through to the label underneath */}
      <span className="pointer-events-none relative min-w-0">
        <span className="flex items-center gap-1 text-sm font-medium text-slate-800">
          <span id={`${name}-title`}>{title}</span>
          <span className="pointer-events-auto relative z-10 -m-4 flex p-4"><Info text={info} title={title} size={12} /></span>
        </span>
        <span id={`${name}-text`} className="mt-0.5 block text-xs text-slate-500">{text}</span>
      </span>
    </div>
  );
}

/** A titled block of related fields inside a section. */
function Group({ title, info, hint, icon, children }: { title: string; info: string; hint?: ReactNode; icon?: IconName; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="min-w-0">
      <div className={SUBHEAD}>{icon && <Icon name={icon} size={12} />}{title}<Info text={info} title={title} size={12} /></div>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/** "SPF  [theek hai]" style pair. soft = optional item, shown amber instead of red when missing. */
function Check({ name, ok, okText = "theek hai", soft = false, mono = false }: { name: string; ok: boolean; okText?: string; soft?: boolean; mono?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={mono ? "font-mono text-2xs text-slate-600" : "text-xs font-medium text-slate-600"}>{name}</span>
      <Badge v={ok ? "ok" : "missing"} label={ok ? okText : "missing"} tone={ok ? "emerald" : soft ? "amber" : "red"} />
    </span>
  );
}

function StatusRow({ label, info, children }: { label: string; info: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4">
      <dt className="flex shrink-0 items-center gap-1 text-xs font-medium text-slate-500 sm:w-28">{label}<Info text={info} title={label} size={12} /></dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">{children}</dd>
    </div>
  );
}

/** Daily cap for the first sending days, with the same formula the sender uses. */
function rampOf(s: Settings) {
  const days: number[] = [];
  for (let d = 0; d < 6; d++) {
    days.push(capFor(s, d));
    if (capFor(s, d + 1) === days[d]) return { days, steady: true, top: days[d] };
  }
  return { days, steady: false, top: capFor(s, 1000) };
}

export default async function SettingsPage() {
  const s = await getSettings();
  const st = await getState();
  const envOk = { smtp: !!process.env.SMTP_PASSWORD, ai: !!process.env.AI_API_KEY };
  const envMissing = [!envOk.smtp && "SMTP_PASSWORD", !envOk.ai && "AI_API_KEY"].filter((k): k is string => !!k);
  const missing = ([[s.fromEmail, "From address"], [s.testEmail, "Test address"], [s.senderName, "Naam"], [s.postalAddress, "Postal address"]] as const)
    .filter(([v]) => !v).map(([, label]) => label);
  // From and Test address are in the Mailbox card; Naam and Postal address are in Sender profile
  const fix = !s.fromEmail || !s.testEmail ? { href: "#mailbox", cta: "Mailbox bharo" } : { href: "#profile", cta: "Profile bharo" };
  // notify() sends to Alert address, else Test address: with both empty, auto-pause, reply and daily report mails go nowhere
  const noAlertTo = !s.alertEmail && !s.testEmail;
  const dns = st.dns;
  const dnsBad = !!dns && (!dns.spf || !dns.dkim);
  const ready = !missing.length && !!dns && !dnsBad;
  const planCap = Math.floor(s.planDailyLimit * 0.4);
  const ramp = rampOf(s);
  const sig = signature(s);

  const next: { text: ReactNode; href: string; cta: string; tone: "indigo" | "emerald" | "amber" } = missing.length
    ? { text: <>Neeche <b>{andList(missing)}</b> bharo, phir <b>Settings save karo</b> dabao.</>, ...fix, tone: "indigo" }
    : !dns
      ? { text: <>Save ke baad <b>Test mail mujhe bhejo</b> aur <b>DNS check karo</b> dabao.</>, href: "#check", cta: "Test karo", tone: "indigo" }
      : dnsBad
        ? { text: <>Hostinger DNS mein {[!dns.spf && "SPF", !dns.dkim && "DKIM"].filter(Boolean).join(" aur ")} theek karo, phir <b>DNS check karo</b> dobara dabao.</>, href: "#dns", cta: "DNS detail dekho", tone: "amber" }
        // the Dashboard knows the real next step (ledger, import, campaign, approvals...); Settings does not
        : { text: <>Settings theek hain. Aage kya karna hai, wo Dashboard ka <b>Aapka agla step</b> batayega.</>, href: "/", cta: "Dashboard kholo", tone: "emerald" };

  return (
    <div>
      <PageHeader
        title="Settings"
        info={"Pehli baar setup:\n1. Neeche Mailbox aur Sender profile bharo.\n2. Neeche wali bar mein 'Settings save karo' dabao.\n3. Phir 'Test mail mujhe bhejo' aur 'DNS check karo' dabao.\nPasswords yahan nahi daalte, wo server ki .env file mein rehte hain."}
        sub="Mailbox, signature, sending rules, AI aur DNS: sab yahin set hota hai."
        actions={
          // phones: a 4-column grid, so every part (DNS too) is visible without sideways scrolling
          <nav aria-label="Settings ke hisse" className="seg scrollbar-none max-sm:grid max-sm:w-full max-sm:grid-cols-4">
            {JUMP.map(([id, label]) => <a key={id} href={`#${id}`} className="seg-item justify-center">{label}</a>)}
          </nav>
        }
      />

      <div className="space-y-4">
        <NextStep text={next.text} href={next.href} cta={next.cta} tone={next.tone} />

        {envMissing.length > 0 && (
          <>
            <Callout tone="danger" title={`Server ki .env mein ${envMissing.join(" aur ")} nahi hai`}>
              {!envOk.smtp && "SMTP_PASSWORD ke bina koi mail nahi jaati. "}
              {!envOk.ai && "AI_API_KEY ke bina AI drafts nahi likhta. "}
              Server pe .env mein daalo, phir <code className={CODE}>pm2 restart outreach-web outreach-worker</code> chalao.
            </Callout>
            <ToastOnMount kind="error" title={`.env mein ${envMissing.join(" aur ")} missing hai`} text="Inke bina mail ya AI kaam nahi karega. Server ki .env file mein daalo." once={`settings:env:${envMissing.join(",")}`} />
          </>
        )}

        {missing.length > 0 && (
          <>
            <Callout tone="warn" title="Kuch zaroori settings khaali hain">
              <b>{andList(missing)}</b> bharo aur save karo. Inke bina mail sahi se nahi jaa sakti.
              {noAlertTo && <> Alert aur Test address dono khaali hain, isliye <b>auto-pause, reply aur daily report</b> ki mail abhi aap tak nahi pahunchti.</>}
            </Callout>
            <ToastOnMount kind="warning" title="Kuch zaroori settings khaali hain"
              text={`${andList(missing)} bharo aur save karo.${noAlertTo ? " Tab tak auto-pause, reply aur daily report ki mail aap tak nahi pahunchegi." : ""}`}
              href={fix.href} cta={fix.cta} once={`settings:missing:${missing.join(",")}`} />
          </>
        )}

        {/* ---------- tests and status (outside the form: these buttons never submit it, and the Mode link is not among unsaved fields) ---------- */}
        <Section id="check" className="scroll-mt-20" icon="zap" title="Connection test"
          info={"Ye buttons check karte hain ki sab sahi se juda hai:\n• SMTP test: mail bhejne ka login\n• IMAP test: inbox padhne ka login\n• Test mail: ek asli sample mail aapke test address pe\n• AI test: AI key aur model\n• DNS check: SPF, DKIM, DMARC records\n• Inbox sync: replies abhi laao\nSettings badli hain to pehle save karo, phir test karo.\nTest fail ho to: SMTP/IMAP mein host, port, SSL switch aur .env ka password dekho. AI mein Base URL, Model aur AI_API_KEY dekho."}
          sub="Save ke baad yahan test karo. Har test ka result screen pe chhote popup mein dikhega.">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <ActionButton action={testSmtpAction} label="SMTP test" icon="server" pendingText="SMTP check ho raha hai…" errTitle="SMTP test fail hua" className={TEST_BTN} />
            <ActionButton action={testImapAction} label="IMAP test" icon="inbox" pendingText="IMAP check ho raha hai…" errTitle="IMAP test fail hua" className={TEST_BTN} />
            <ActionButton action={testMailAction} label="Test mail mujhe bhejo" icon="mail" pendingText="Test mail ja rahi hai…" errTitle="Test mail nahi gayi" className={TEST_BTN} />
            <ActionButton action={testAiAction} label="AI test" icon="bot" pendingText="AI check ho raha hai…" errTitle="AI test fail hua" className={TEST_BTN} />
            <ActionButton action={dnsAction} label="DNS check karo" icon="shield" pendingText="DNS check ho raha hai…" errTitle="DNS check mein problem" className={TEST_BTN}
              next={!dns ? "/ledger" : dnsBad ? "/campaigns" : undefined} nextCta={!dns ? "Aage: Ledger kholo" : "Campaigns kholo"} />
            <ActionButton action={syncNowAction} label="Inbox abhi sync karo" icon="refresh" pendingText="Inbox sync ho raha hai…" errTitle="Inbox sync fail hua" className={TEST_BTN} next="/replies" nextCta="Replies dekho" />
          </div>
          <dl className="mt-4 divide-y divide-slate-200/70 rounded-lg border border-slate-200/80 bg-slate-50/60">
            <StatusRow label="Mode" info="DRY-RUN = har mail sirf aapke test address pe jaati hai, asli lead ko nahi. LIVE = mails asli leads ko jaati hain. Mode sirf Dashboard ke switch se badalta hai, Settings save karne se nahi.">
              <Badge v={s.dryRun ? "dry-run" : "live"} label={s.dryRun ? "DRY-RUN" : "LIVE"} />
              <span className="text-xs text-slate-600">{s.dryRun ? "Mails sirf aapke test address pe jaati hain" : "Mails asli leads ko jaa rahi hain"}</span>
              <Link href="/#mode" className="link inline-flex items-center gap-0.5 text-xs">Dashboard pe badlo<Icon name="arrow-right" size={12} /></Link>
            </StatusRow>
            <StatusRow label="Server .env" info="Passwords aur API key server ki .env file mein rehte hain, yahan kabhi nahi dikhte. 'missing' ho to server pe .env mein daalo aur pm2 restart karo.">
              <Check name="SMTP_PASSWORD" ok={envOk.smtp} okText="set hai" mono />
              <Check name="AI_API_KEY" ok={envOk.ai} okText="set hai" mono />
            </StatusRow>
            <StatusRow label="DNS" info="Pichhle DNS check ka result. SPF aur DKIM zaroori hain: inke bina campaign start nahi hota. DMARC optional hai, par inbox tak pahunchne mein madad karta hai.">
              {dns ? (
                <>
                  <Check name="SPF" ok={dns.spf} />
                  <Check name="DKIM" ok={dns.dkim} />
                  <Check name="DMARC" ok={dns.dmarc} soft />
                  <span className="text-2xs text-slate-400">Pichhla check: {fmt(dns.at)}</span>
                </>
              ) : <span className="text-xs text-slate-500">Abhi check nahi hua. <b className="font-medium text-slate-700">DNS check karo</b> dabao.</span>}
            </StatusRow>
            <StatusRow label="Inbox sync" info="Worker har 10 minute mein inbox apne aap sync karta hai (replies, bounce, opt-out). Abhi chahiye to 'Inbox abhi sync karo' dabao.">
              <span className="text-xs text-slate-600">{st.lastSyncAt ? <>Pichhla sync: {fmt(st.lastSyncAt)}</> : "Abhi tak sync nahi hua"}</span>
            </StatusRow>
          </dl>
        </Section>

        {/* ---------- every setting is in this one form ---------- */}
        <ActionForm action={saveSettingsAction} ok="Settings save ho gayi" next={ready ? "/" : "#check"} nextCta={ready ? "Dashboard pe jao" : "Ab connection test karo"} className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Section id="mailbox" className="scroll-mt-20 lg:col-span-2" icon="mail" title="Mailbox (SMTP / IMAP)"
              info="Aapka email account: SMTP se mails jaati hain, IMAP se inbox padha jaata hai (replies, bounce, opt-out). Hostinger ke host aur port pehle se bhare hain, aam taur pe sirf apna email daalna hota hai."
              sub="Mail bhejne aur inbox padhne wala account">
              <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
                <div className="min-w-0">
                  <h3 className={SUBHEAD}><Icon name="send" size={12} />SMTP · mail bhejna</h3>
                  <div className="space-y-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                      <Field label="SMTP host" info="Mail bhejne wala server." hint="Hostinger: smtp.hostinger.com"><Txt name="smtpHost" value={s.smtpHost} plain /></Field>
                      <Field label="Port" info="465 = SSL (neeche SSL switch on). 587 = STARTTLS (SSL switch off)."><Num name="smtpPort" value={s.smtpPort} /></Field>
                    </div>
                    <Toggle name="smtpSecure" checked={s.smtpSecure} title="SSL/TLS" text="465 = SSL (on) · 587 = STARTTLS (off)"
                      info="Port 465 ke saath on rakho. Port 587 (STARTTLS) ke saath off rakho, wahan connection baad mein encrypt hota hai." />
                    <Field label="SMTP user" info="Mailbox ka login naam. Khaali chhodo to From address hi login ban jaata hai." hint="Aam taur pe aapka email"><Txt name="smtpUser" value={s.smtpUser} plain mode="email" /></Field>
                  </div>
                </div>
                <div className="min-w-0">
                  <h3 className={SUBHEAD}><Icon name="inbox" size={12} />IMAP · inbox padhna</h3>
                  <div className="space-y-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                      <Field label="IMAP host" info="Inbox padhne wala server. Replies, bounce aur opt-out isi se pakde jaate hain." hint="Hostinger: imap.hostinger.com"><Txt name="imapHost" value={s.imapHost} plain /></Field>
                      <Field label="Port" info="993 = SSL. Hostinger pe 993 hi rakho."><Num name="imapPort" value={s.imapPort} /></Field>
                    </div>
                    <Toggle name="imapSecure" checked={s.imapSecure} title="SSL/TLS" text="993 = SSL (on)" info="Inbox ka connection encrypted rehta hai. Port 993 ke saath on rakho." />
                    <Field label="IMAP user" info="Inbox ka login. Aam taur pe SMTP wala hi hota hai, isliye khaali chhod sakte ho." hint="Khaali = SMTP user"><Txt name="imapUser" value={s.imapUser} plain mode="email" /></Field>
                  </div>
                </div>
              </div>

              <div className="mt-6 border-t border-slate-100 pt-5">
                <h3 className={SUBHEAD}><Icon name="mail-check" size={12} />Email address</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="From address" info="Leads ko mail isi address se jaati hai. Ye aapke apne domain ka hona chahiye, DNS check isi domain ka hota hai." hint={req(s.fromEmail, "Mail isi address se jayegi")}>
                    <Txt name="fromEmail" value={s.fromEmail} plain mode="email" warn={!s.fromEmail} />
                  </Field>
                  <Field label="Test address" info="Aapka apna personal email. DRY-RUN mode mein har mail sirf yahan aati hai, aur 'Test mail mujhe bhejo' bhi yahin aati hai." hint={req(s.testEmail, "Dry-run aur test mails isi pe aati hain")}>
                    <Txt name="testEmail" value={s.testEmail} plain mode="email" warn={!s.testEmail} />
                  </Field>
                  <Field label="Alert address" info="Sending apne aap ruk jaaye (auto-pause), kisi lead ka reply aaye, ya daily report bane: notification is address pe aata hai. Khaali = Test address. Dono khaali hon to ye mails kahin nahi jaati."
                    hint={noAlertTo
                      ? <><span className="font-semibold text-amber-600">Abhi auto-pause, reply aur daily report ki mail kahin nahi jaati.</span> Alert ya Test address bharo.</>
                      : "Auto-pause, replies aur daily report yahan aate hain"}>
                    <Txt name="alertEmail" value={s.alertEmail} plain mode="email" warn={noAlertTo} />
                  </Field>
                </div>
              </div>
              <p className="mt-5 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
                <Icon name="lock" size={13} className="mt-px text-slate-400" />
                <span>Passwords sirf server ki .env file se aate hain (<code className={CODE}>SMTP_PASSWORD</code>, <code className={CODE}>IMAP_PASSWORD</code>, <code className={CODE}>AI_API_KEY</code>). Yahan password nahi daalna.</span>
              </p>
            </Section>

            <Section id="profile" className="scroll-mt-20" icon="user" title="Sender profile (signature)"
              info="Har mail ke neeche signature aur footer app khud lagata hai, AI nahi. Yahan wahi bharo jo leads ko dikhna chahiye. Neeche preview mein dekho mail ke end mein kya jaata hai."
              sub="Har mail ke neeche yahi signature lagta hai">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Naam" info="Signature ki pehli line. Inbox mein 'From' ke saath bhi yahi naam dikhta hai." hint={req(s.senderName, "From ke saath dikhta hai")}>
                    <Txt name="senderName" value={s.senderName} warn={!s.senderName} />
                  </Field>
                  <Field label="Role" info="Signature mein naam ke neeche dikhta hai." hint="Jaise: Web designer"><Txt name="senderRole" value={s.senderRole} /></Field>
                  <Field label="Business" info="Role ke saath dikhta hai. Khaali ho to AI aapko freelancer maan ke likhta hai." hint="Khaali = freelance"><Txt name="business" value={s.business} /></Field>
                  <Field label="Website" info="Signature mein aapki website ka link." hint="Jaise: https://aapki-site.com"><Txt name="website" value={s.website} plain mode="url" /></Field>
                </div>
                <Field label="Portfolio links" info="Signature mein website ke neeche dikhte hain. Ek line mein ek link." hint="Ek line mein ek link">
                  <textarea name="portfolio" defaultValue={s.portfolio} rows={3} className="input" {...PLAIN} />
                </Field>
                <Field label="Postal address" info="Har mail ke footer mein dikhta hai. Cold email ke law (jaise CAN-SPAM) ke hisaab se ye zaroori hai." hint={req(s.postalAddress, "Footer mein dikhta hai (law ke hisaab se zaroori)")}>
                  <textarea name="postalAddress" defaultValue={s.postalAddress} rows={2} className={`input ${!s.postalAddress ? WARN_INPUT : ""}`} />
                </Field>
                <Toggle name="signatureLogo" checked={s.signatureLogo} title="Signature mein logo" text="Off = sirf plain text, naye domain ke liye sabse safe"
                  info="On karne pe mail HTML mein jaati hai aur signature ke neeche chhota logo dikhta hai. Logo mail ke andar hi hota hai, bahar se load nahi hota. Naye domain ke warm-up mein off rakhna sabse safe hai." />
                <details className="group rounded-lg border border-slate-200">
                  <summary className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition hover:text-slate-900">
                    <Icon name="eye" size={14} className="text-slate-400" />Signature preview dekho
                    <Icon name="chevron-down" size={14} className="ml-auto text-slate-400 transition group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-slate-100 px-3 py-3">
                    {sig
                      ? <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-slate-800">{sig}</pre>
                      : <p className="text-xs text-slate-500">Signature abhi khaali hai. Naam bharo aur save karo.</p>}
                    <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-2xs leading-relaxed text-slate-400">{footer("en", "[source]", s.postalAddress)}</pre>
                    <p className="hint">Saved settings se bana hai. Footer lead ki bhasha mein jaata hai, aur [source] ki jagah lead kahan se mila wo aata hai.</p>
                  </div>
                </details>
              </div>
            </Section>

            {/* flex column: next to the taller Sender profile card the two big boxes grow instead of leaving a blank gap */}
            <Section id="offer" className="scroll-mt-20 flex flex-col" icon="bulb" title="Offer notes (AI ke liye)"
              info="AI har mail likhte waqt sirf yahi baatein use karta hai. Sirf sach likho: jo yahan nahi likha, AI wo claim nahi karta. Chhota aur seedha rakho."
              sub="AI sirf yahi sach baatein use karta hai">
              <div className="flex flex-1 flex-col gap-4">
                <Field className="flex flex-1 flex-col" label="Aap kya offer karte ho" info="Aapki service 1-2 line mein. Har mail ka main point yahi banta hai." hint="1-2 line, seedhi bhasha mein">
                  <textarea name="offerWhat" defaultValue={s.offerWhat} rows={4} className="input flex-1" />
                </Field>
                <Field className="flex flex-1 flex-col" label="Proof points (sirf sach)" info="Asli results, clients ya experience. AI inhe tabhi use karta hai jab lead ke liye relevant ho, aur kabhi badha-chadha ke nahi." hint="Khaali = AI koi proof claim nahi karega">
                  <textarea name="offerProof" defaultValue={s.offerProof} rows={4} placeholder="Jaise: 5 saal ka experience, 40+ small business websites" className="input flex-1" />
                </Field>
                <Field label="Tone" info="Mail kis andaaz mein likhi jaaye." hint="Jaise: Friendly, short, honest, no hype">
                  <textarea name="offerTone" defaultValue={s.offerTone} rows={2} className="input" />
                </Field>
              </div>
            </Section>

            <Section id="rules" className="scroll-mt-20 lg:col-span-2" icon="clock" title="Sending rules"
              info="Mails kab aur kitni jaayengi: sirf chune hue dino mein, window ke andar, har mail ke beech random gap ke saath. Naya domain warm-up se dheere dheere badhta hai, taaki mails spam mein na jaayein."
              sub="Kab, kitni aur kitne gap pe mails jaayengi">
              <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
                <Group title="Sending din" icon="calendar" info="Sirf in dino mein mails jaati hain. Din campaign ke timezone (lead ke desh) ke hisaab se gine jaate hain. Weekend band rakhna safe hai." hint="Campaign ke timezone ke hisaab se">
                  <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                    {DAYS.map((d, i) => (
                      <label key={d} className="relative cursor-pointer">
                        <input type="checkbox" name="sendDays" value={i + 1} defaultChecked={s.sendDays.includes(i + 1)} className="peer sr-only" />
                        <span className="flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-2xs font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-800 peer-checked:border-indigo-600 peer-checked:bg-indigo-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 peer-focus-visible:ring-offset-1 xl:text-xs">{d}</span>
                      </label>
                    ))}
                  </div>
                </Group>
                <Group title="Sending window" icon="clock" info="Roz sirf is samay ke beech mails jaati hain. Samay campaign ke timezone mein hai, aapke nahi, taaki mail lead ke office time mein pahunche." hint="Campaign ke timezone mein (lead ke desh ka samay)">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Kab se"><input name="windowStart" type="time" defaultValue={s.windowStart} className="input tabular-nums" /></Field>
                    <Field label="Kab tak"><input name="windowEnd" type="time" defaultValue={s.windowEnd} className="input tabular-nums" /></Field>
                  </div>
                </Group>
                <Group title="Do mails ke beech gap (minute)" icon="history" info="Har mail ke baad random gap, kam se kam aur zyada se zyada ke beech. Isse sending insaan jaisi lagti hai aur spam filter shak nahi karte." hint="Kam gap = tez sending, par spam ka risk zyada">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Kam se kam"><Num name="gapMinMin" value={s.gapMinMin} /></Field>
                    <Field label="Zyada se zyada"><Num name="gapMaxMin" value={s.gapMaxMin} /></Field>
                  </div>
                </Group>
                <Group title="Warm-up" icon="trending" info="Naye domain ko dheere dheere badhao. Pehle sending din 'Pehla din' jitni mails, phir har sending din 'Har din +' jitni badhti hain, 'Max / din' tak." hint="Pehle din kitni, har sending din kitni badhengi, max kitni">
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Pehla din"><Num name="warmStart" value={s.warmStart} /></Field>
                    <Field label="Har din +"><Num name="warmStep" value={s.warmStep} /></Field>
                    <Field label="Max / din"><Num name="warmMax" value={s.warmMax} /></Field>
                  </div>
                </Group>
                <Group title="Mailbox plan" icon="server" info="Aapke mailbox plan ki roz ki sending limit (Hostinger plan mein likhi hoti hai). Safety ke liye app iska 40% se zyada kabhi nahi bhejta. 0 = plan limit nahi lagegi, sirf warm-up."
                  hint={s.planDailyLimit > 0 ? `Plan ka 40% se zyada kabhi nahi: ${planCap}/din` : "0 = sirf warm-up ki limit lagegi"}>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Plan limit / din"><Num name="planDailyLimit" value={s.planDailyLimit} /></Field>
                  </div>
                </Group>
                <Group title="Roz kitni mails jaayengi" icon="activity" info="Saved settings se: warm-up aur plan limit (40%) mein jo kam ho, roz utni hi mails jaati hain. 'Din' = asli sending din, jis din live mail gayi. Save karne ke baad ye update hota hai."
                  hint={ramp.steady ? `Din ${ramp.days.length} se roz ${ramp.top}` : `Aage badhte badhte max ${ramp.top}/din tak`}>
                  <ol className="grid grid-cols-6 gap-1.5">
                    {ramp.days.map((n, i) => (
                      <li key={i} className={`rounded-lg px-1 py-1.5 text-center ring-1 ring-inset ${ramp.steady && i === ramp.days.length - 1 ? "bg-indigo-50 ring-indigo-200/70" : "bg-slate-50 ring-slate-200/70"}`}>
                        <div className="text-2xs text-slate-400">Din {i + 1}{ramp.steady && i === ramp.days.length - 1 ? "+" : ""}</div>
                        <div className="text-sm font-semibold tabular-nums text-slate-800">{n}</div>
                      </li>
                    ))}
                  </ol>
                </Group>
              </div>

              {/* Mode (DRY-RUN / LIVE) and its Dashboard link live in the Connection test card: a link here, next to unsaved fields, invites leaving without saving */}
              <div className="mt-6 grid gap-3 border-t border-slate-100 pt-5 md:grid-cols-2">
                <Toggle name="approveEach" checked={s.approveEach} title="Har mail approve karke hi bhejo" text="On = har mail 'Approve Karo' page pe rukti hai"
                  info="On (recommended): AI ki har mail 'Approve Karo' page pe rukti hai aur aapke approve karne ke baad hi jaati hai. Off: drafts apne aap approve ho jaate hain." />
              </div>
            </Section>

            <Section id="ai" className="scroll-mt-20" icon="bot" title="AI (OpenAI-compatible)"
              info="AI mail drafts likhta hai aur replies ka English translation karta hai. Koi bhi OpenAI-compatible service chalegi: OpenAI, Groq, OpenRouter. Badalne ke baad save karke 'AI test' dabao."
              sub="Drafts likhne aur replies translate karne ke liye">
              <div className="space-y-4">
                <Field label="Base URL" info="AI service ka API address. Apni service ka URL neeche ke examples se copy karo."
                  hint={<span className="flex flex-wrap items-center gap-1">Jaise:{AI_URLS.map((u) => <code key={u} className={`${CODE} break-all`}>{u}</code>)}</span>}>
                  <Txt name="aiBaseUrl" value={s.aiBaseUrl} plain mode="url" />
                </Field>
                <Field label="Model" info="Kaunsa model mail likhe. Sasta aur tez model kaafi hai." hint="Jaise: gpt-4o-mini"><Txt name="aiModel" value={s.aiModel} plain /></Field>
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
                  <Icon name="lock" size={13} className="text-slate-400" />
                  <span className="min-w-0 flex-1">API key server ki .env mein <code className={CODE}>AI_API_KEY</code> se aati hai</span>
                  <Badge v={envOk.ai ? "ok" : "missing"} label={envOk.ai ? "set hai" : "missing"} tone={envOk.ai ? "emerald" : "red"} />
                </div>
              </div>
            </Section>

            <Section id="dns" className="scroll-mt-20" icon="shield" title="Domain health (DNS)"
              info="Mail inbox mein pahunche, spam mein nahi: iske liye domain ke DNS records chahiye. SPF aur DKIM zaroori hain, inke bina campaign start nahi hota. DMARC optional hai par achha hai. Records Hostinger hPanel ke DNS Zone mein milte hain."
              sub="SPF, DKIM aur DMARC records">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Sending domain" info="Jis domain se mail jaati hai. Khaali chhodo to From address ka domain le liya jaata hai." hint="Khaali = From address ka domain">
                    <Txt name="domain" value={s.domain} plain placeholder={s.fromEmail.split("@")[1] || "aapka-domain.com"} />
                  </Field>
                  <Field label="DKIM selector" info="DKIM record ka naam: selector._domainkey.aapka-domain. Hostinger pe aam taur pe hostingermail-a hota hai." hint="Hostinger: hostingermail-a (ya -b, -c)">
                    <Txt name="dkimSelector" value={s.dkimSelector} plain />
                  </Field>
                </div>
                {dns ? (
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
                      <Check name="SPF" ok={dns.spf} />
                      <Check name="DKIM" ok={dns.dkim} />
                      <Check name="DMARC" ok={dns.dmarc} soft />
                      <span className="text-2xs text-slate-400 sm:ml-auto">{fmt(dns.at)}</span>
                    </div>
                    <pre className="whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-2xs leading-relaxed text-slate-600">{dns.detail}</pre>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
                    DNS abhi check nahi hua. Save karke upar <a href="#check" className="link">DNS check karo</a> dabao.
                  </div>
                )}
                {dnsBad && (
                  <Callout tone="warn" title="Campaign start nahi hoga" action={<a href="#check" className="btn btn-sm">Dobara check karo</a>}>
                    Hostinger hPanel ke DNS Zone mein {[!dns?.spf && "SPF", !dns?.dkim && "DKIM"].filter(Boolean).join(" aur ")} record theek karo, phir DNS dobara check karo.
                  </Callout>
                )}
              </div>
            </Section>
          </div>

          {/* on desktop the button sits on the left: toasts appear bottom-right and would cover it */}
          <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+68px)] z-20 flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2.5 shadow-pop backdrop-blur sm:px-4 lg:bottom-4">
            <p className="flex min-w-0 flex-1 items-center gap-2 text-xs text-slate-600 sm:text-sm">
              <Icon name="info" size={15} className="hidden text-indigo-500 sm:block" />Badlaav karne ke baad save karna mat bhoolo
            </p>
            <SubmitButton className="btn-primary shrink-0 lg:order-first" icon="check" pendingText="Save ho raha hai…">Settings save karo</SubmitButton>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}
