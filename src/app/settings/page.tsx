import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { getSettings, getState, type Settings } from "@/lib/settings";
import { capFor } from "@/lib/schedule";
import { signature } from "@/lib/compose";
import { footer } from "@/lib/lang";
import { fromHeader } from "@/lib/mailer";
import { TEMPLATE_IDS, templateOf } from "@/lib/templates";
import { fmt } from "@/lib/time";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { saveSettingsAction, testSmtpAction, testImapAction, testMailAction, testAiAction, dnsAction, syncNowAction } from "../actions";
import { ActionButton } from "@/components/ActionButton";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Info } from "@/components/Info";
import { Icon, type IconName } from "@/components/icons";
import { ToastOnMount } from "@/components/toast";
import { Badge, Callout, Field, NextStep, PageHeader, Section } from "@/components/ui";
import { EXAMPLE_LEAD } from "./template-check";
import { TemplateEditor } from "./TemplateEditor";

// "Settings" reads the same in Hinglish and English
export const metadata = { title: "Settings" };

// [Hinglish, English]; checkbox value 1..7 = Mon..Sun
const DAYS: [string, string][] = [["Som", "Mon"], ["Mangal", "Tue"], ["Budh", "Wed"], ["Guru", "Thu"], ["Shukra", "Fri"], ["Shani", "Sat"], ["Ravi", "Sun"]];
const AI_URLS = ["https://api.openai.com/v1", "https://api.groq.com/openai/v1", "https://openrouter.ai/api/v1"];
// [section id, label]: the labels read the same in both languages
const JUMP: [string, string][] = [["check", "Test"], ["mailbox", "Mailbox"], ["profile", "Profile"], ["offer", "Offer"], ["templates", "Templates"], ["rules", "Rules"], ["ai", "AI"], ["dns", "DNS"]];
// Template placeholders (lib/templates.ts) and where their values come from
const PLACEHOLDERS: { k: string; hi: string; en: string }[] = [
  { k: "business", hi: "Business ka naam (CSV)", en: "Business name (CSV)" },
  { k: "contact", hi: "Contact person ka naam (CSV)", en: "Contact person's name (CSV)" },
  { k: "city", hi: "City (CSV)", en: "City (CSV)" },
  { k: "category", hi: "Business ka type, jaise restaurant (CSV)", en: "Type of business, e.g. restaurant (CSV)" },
  { k: "country", hi: "Desh (CSV)", en: "Country (CSV)" },
  { k: "my_name", hi: "Aapka Naam (Sender profile)", en: "Your Name (Sender profile)" },
  { k: "my_business", hi: "Aapka Business (Sender profile)", en: "Your Business (Sender profile)" },
];
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
/** Hint with a "required" marker while a required field is still empty. */
function req(t: T, value: string, hint: string): ReactNode {
  return value ? hint : <><span className="font-semibold text-amber-600">{t("Zaroori, abhi khaali hai.", "Required, still empty.")}</span> {hint}</>;
}
/** "A", "A aur B" / "A and B", "A, B aur C" / "A, B and C" */
const andList = (t: T, xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} ${t("aur", "and")} ${xs[xs.length - 1]}` : xs[0] || "");
/** English pronoun for n items ("Add it" / "Add them"); the Hinglish texts need none. */
const itThem = (n: number) => (n > 1 ? "them" : "it");

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

/** "SPF  [theek hai / OK]" style pair. soft = optional item, shown amber instead of red when missing. */
function Check({ name, ok, okText, soft = false, mono = false }: { name: string; ok: boolean; okText: string; soft?: boolean; mono?: boolean }) {
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
  const { t } = await getT();
  const s = await getSettings();
  const st = await getState();
  const envOk = { smtp: !!process.env.SMTP_PASSWORD, ai: !!process.env.AI_API_KEY };
  const envMissing = [!envOk.smtp && "SMTP_PASSWORD", !envOk.ai && "AI_API_KEY"].filter((k): k is string => !!k);
  // required fields that are still empty, as [field, label]: the toast's once-key uses the field names, so a language switch does not show it again
  const empty = ([["fromEmail", "From address"], ["testEmail", "Test address"], ["senderName", t("Naam", "Name")], ["postalAddress", "Postal address"]] as const)
    .filter(([k]) => !s[k]);
  const missing = empty.map(([, label]) => label);
  const missingList = andList(t, missing);
  // From and Test address are in the Mailbox card; Naam and Postal address are in Sender profile
  const fix = !s.fromEmail || !s.testEmail ? { href: "#mailbox", cta: t("Mailbox bharo", "Fill in mailbox") } : { href: "#profile", cta: t("Profile bharo", "Fill in profile") };
  // notify() sends to Alert address, else Test address: with both empty, auto-pause, reply and daily report mails go nowhere
  const noAlertTo = !s.alertEmail && !s.testEmail;
  const dns = st.dns;
  const dnsBad = !!dns && (!dns.spf || !dns.dkim);
  // the required records the last DNS check did not find (shown only when dnsBad)
  const dnsFix = [!dns?.spf && "SPF", !dns?.dkim && "DKIM"].filter(Boolean).join(t(" aur ", " and "));
  const ready = !missing.length && !!dns && !dnsBad;
  const planCap = Math.floor(s.planDailyLimit * 0.4);
  const ramp = rampOf(s);
  const sig = signature(s);
  // the name every lead sees in the inbox, by the mailer's own rule: From name, else Business, else Name
  const from = fromHeader(s);
  const inboxName = typeof from === "string" ? "" : from.name;
  // Name = Business makes "I'm X from X" in templates and AI mails (the inbox name no longer needs Name for that)
  const sameName = !!s.senderName.trim() && s.senderName.trim().toLowerCase() === s.business.trim().toLowerCase();
  const okText = t("theek hai", "OK");
  const setText = t("set hai", "set");

  const next: { text: ReactNode; href: string; cta: string; tone: "indigo" | "emerald" | "amber" } = missing.length
    ? { text: t(<>Neeche <b>{missingList}</b> bharo, phir <b>Settings save karo</b> dabao.</>, <>Fill in <b>{missingList}</b> below, then click <b>Save settings</b>.</>), ...fix, tone: "indigo" }
    : !dns
      ? { text: t(<>Save ke baad <b>Test mail mujhe bhejo</b> aur <b>DNS check karo</b> dabao.</>, <>After saving, click <b>Send test mail to me</b> and <b>Check DNS</b>.</>), href: "#check", cta: t("Test karo", "Run tests"), tone: "indigo" }
      : dnsBad
        ? { text: t(<>Hostinger DNS mein {dnsFix} theek karo, phir <b>DNS check karo</b> dobara dabao.</>, <>Fix {dnsFix} in Hostinger DNS, then click <b>Check DNS</b> again.</>), href: "#dns", cta: t("DNS detail dekho", "See DNS details"), tone: "amber" }
        // the Dashboard knows the real next step (ledger, import, campaign, approvals...); Settings does not
        : { text: t(<>Settings theek hain. Aage kya karna hai, wo Dashboard ka <b>Aapka agla step</b> batayega.</>, <>Settings look good. <b>Your next step</b> on the Dashboard tells you what to do next.</>), href: "/", cta: t("Dashboard kholo", "Open dashboard"), tone: "emerald" };

  return (
    <div>
      <PageHeader
        title="Settings"
        info={t(
          "Pehli baar setup:\n1. Neeche Mailbox aur Sender profile bharo.\n2. Neeche wali bar mein 'Settings save karo' dabao.\n3. Phir 'Test mail mujhe bhejo' aur 'DNS check karo' dabao.\nPasswords yahan nahi daalte, wo server ki .env file mein rehte hain.",
          "First-time setup:\n1. Fill in Mailbox and Sender profile below.\n2. Click 'Save settings' in the bar at the bottom.\n3. Then click 'Send test mail to me' and 'Check DNS'.\nPasswords are not entered here; they live in the server's .env file.",
        )}
        sub={t("Mailbox, signature, email templates, sending rules, AI aur DNS: sab yahin set hota hai.", "Mailbox, signature, email templates, sending rules, AI and DNS: all set up here.")}
        actions={
          // phones: a 4-column grid, so every part (DNS too) is visible without sideways scrolling
          <nav aria-label={t("Settings ke hisse", "Settings sections")} className="seg scrollbar-none max-sm:grid max-sm:w-full max-sm:grid-cols-4">
            {JUMP.map(([id, label]) => <a key={id} href={`#${id}`} className="seg-item justify-center">{label}</a>)}
          </nav>
        }
      />

      <div className="space-y-4">
        <NextStep text={next.text} href={next.href} cta={next.cta} tone={next.tone} />

        {envMissing.length > 0 && (
          <>
            <Callout tone="danger" title={t(`Server ki .env mein ${envMissing.join(" aur ")} nahi hai`, `The server's .env is missing ${envMissing.join(" and ")}`)}>
              {!envOk.smtp && t("SMTP_PASSWORD ke bina koi mail nahi jaati. ", "Without SMTP_PASSWORD no mail goes out. ")}
              {!envOk.ai && t("AI_API_KEY ke bina AI drafts nahi likhta. ", "Without AI_API_KEY the AI cannot write drafts. ")}
              {t(
                <>Server pe .env mein daalo, phir <code className={CODE}>pm2 restart outreach-web outreach-worker</code> chalao.</>,
                <>Add {itThem(envMissing.length)} to .env on the server, then run <code className={CODE}>pm2 restart outreach-web outreach-worker</code>.</>,
              )}
            </Callout>
            <ToastOnMount kind="error" title={t(`.env mein ${envMissing.join(" aur ")} missing hai`, `.env is missing ${envMissing.join(" and ")}`)}
              text={t("Inke bina mail ya AI kaam nahi karega. Server ki .env file mein daalo.", `Mail or AI will not work without ${itThem(envMissing.length)}. Add ${itThem(envMissing.length)} to the server's .env file.`)}
              once={`settings:env:${envMissing.join(",")}`} />
          </>
        )}

        {missing.length > 0 && (
          <>
            <Callout tone="warn" title={t("Kuch zaroori settings khaali hain", "Some required settings are empty")}>
              {t(
                <><b>{missingList}</b> bharo aur save karo. Inke bina mail sahi se nahi jaa sakti.</>,
                <>Fill in <b>{missingList}</b> and save. Without {itThem(missing.length)}, mail cannot go out properly.</>,
              )}
              {noAlertTo && t(
                <> Alert aur Test address dono khaali hain, isliye <b>auto-pause, reply aur daily report</b> ki mail abhi aap tak nahi pahunchti.</>,
                <> Alert and Test address are both empty, so <b>auto-pause, reply and daily report</b> mails do not reach you right now.</>,
              )}
            </Callout>
            <ToastOnMount kind="warning" title={t("Kuch zaroori settings khaali hain", "Some required settings are empty")}
              text={t(
                `${missingList} bharo aur save karo.${noAlertTo ? " Tab tak auto-pause, reply aur daily report ki mail aap tak nahi pahunchegi." : ""}`,
                `Fill in ${missingList} and save.${noAlertTo ? " Until then, auto-pause, reply and daily report mails will not reach you." : ""}`,
              )}
              href={fix.href} cta={fix.cta} once={`settings:missing:${empty.map(([k]) => k).join(",")}`} />
          </>
        )}

        {/* ---------- tests and status (outside the form: these buttons never submit it, and the Mode link is not among unsaved fields) ---------- */}
        <Section id="check" className="scroll-mt-20" icon="zap" title="Connection test"
          info={t(
            "Ye buttons check karte hain ki sab sahi se juda hai:\n• SMTP test: mail bhejne ka login\n• IMAP test: inbox padhne ka login\n• Test mail: ek asli sample mail aapke test address pe\n• AI test: AI key aur model\n• DNS check: SPF, DKIM, DMARC records\n• Inbox sync: replies abhi laao\nSettings badli hain to pehle save karo, phir test karo.\nTest fail ho to: SMTP/IMAP mein host, port, SSL switch aur .env ka password dekho. AI mein Base URL, Model aur AI_API_KEY dekho.",
            "These buttons check that everything is connected properly:\n• SMTP test: the login for sending mail\n• IMAP test: the login for reading the inbox\n• Test mail: a real sample mail to your test address\n• AI test: the AI key and model\n• DNS check: SPF, DKIM, DMARC records\n• Inbox sync: fetch replies now\nIf you changed settings, save first, then test.\nIf a test fails: for SMTP/IMAP check the host, port, SSL switch and the password in .env. For AI check Base URL, Model and AI_API_KEY.",
          )}
          sub={t("Save ke baad yahan test karo. Har test ka result screen pe chhote popup mein dikhega.", "After saving, test here. Each test's result shows in a small popup on screen.")}>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <ActionButton action={testSmtpAction} label="SMTP test" icon="server" pendingText={t("SMTP check ho raha hai…", "Checking SMTP…")} errTitle={t("SMTP test fail hua", "SMTP test failed")} className={TEST_BTN} />
            <ActionButton action={testImapAction} label="IMAP test" icon="inbox" pendingText={t("IMAP check ho raha hai…", "Checking IMAP…")} errTitle={t("IMAP test fail hua", "IMAP test failed")} className={TEST_BTN} />
            <ActionButton action={testMailAction} label={t("Test mail mujhe bhejo", "Send test mail to\u00a0me")} icon="mail" pendingText={t("Test mail ja rahi hai…", "Sending test mail…")} errTitle={t("Test mail nahi gayi", "Test mail not sent")} className={TEST_BTN} />
            <ActionButton action={testAiAction} label="AI test" icon="bot" pendingText={t("AI check ho raha hai…", "Checking AI…")} errTitle={t("AI test fail hua", "AI test failed")} className={TEST_BTN} />
            <ActionButton action={dnsAction} label={t("DNS check karo", "Check DNS")} icon="shield" pendingText={t("DNS check ho raha hai…", "Checking DNS…")} errTitle={t("DNS check mein problem", "DNS check found a problem")} className={TEST_BTN}
              next={!dns ? "/ledger" : dnsBad ? "/campaigns" : undefined} nextCta={!dns ? t("Aage: Ledger kholo", "Next: open ledger") : t("Campaigns kholo", "Open campaigns")} />
            <ActionButton action={syncNowAction} label={t("Inbox abhi sync karo", "Sync inbox now")} icon="refresh" pendingText={t("Inbox sync ho raha hai…", "Syncing inbox…")} errTitle={t("Inbox sync fail hua", "Inbox sync failed")} className={TEST_BTN} next="/replies" nextCta={t("Replies dekho", "See replies")} />
          </div>
          <dl className="mt-4 divide-y divide-slate-200/70 rounded-lg border border-slate-200/80 bg-slate-50/60">
            <StatusRow label="Mode" info={t(
              "DRY-RUN = har mail sirf aapke test address pe jaati hai, asli lead ko nahi. LIVE = mails asli leads ko jaati hain. Mode sirf Dashboard ke switch se badalta hai, Settings save karne se nahi.",
              "DRY-RUN = every mail goes only to your test address, never to the real lead. LIVE = mails go to real leads. The mode only changes with the Dashboard switch, not by saving settings.",
            )}>
              <Badge v={s.dryRun ? "dry-run" : "live"} label={s.dryRun ? "DRY-RUN" : "LIVE"} />
              <span className="text-xs text-slate-600">{s.dryRun ? t("Mails sirf aapke test address pe jaati hain", "Mails only go to your test address") : t("Mails asli leads ko jaa rahi hain", "Mails go to real leads")}</span>
              <Link href="/#mode" className="link inline-flex items-center gap-0.5 text-xs">{t("Dashboard pe badlo", "Change on dashboard")}<Icon name="arrow-right" size={12} /></Link>
            </StatusRow>
            <StatusRow label="Server .env" info={t(
              "Passwords aur API key server ki .env file mein rehte hain, yahan kabhi nahi dikhte. 'missing' ho to server pe .env mein daalo aur pm2 restart karo.",
              "Passwords and the API key live in the server's .env file and are never shown here. If one is 'missing', add it to .env on the server and run pm2 restart.",
            )}>
              <Check name="SMTP_PASSWORD" ok={envOk.smtp} okText={setText} mono />
              <Check name="AI_API_KEY" ok={envOk.ai} okText={setText} mono />
            </StatusRow>
            <StatusRow label="DNS" info={t(
              "Pichhle DNS check ka result. SPF aur DKIM zaroori hain: inke bina campaign start nahi hota. DMARC optional hai, par inbox tak pahunchne mein madad karta hai.",
              "Result of the last DNS check. SPF and DKIM are required: without them a campaign cannot start. DMARC is optional, but it helps mails reach the inbox.",
            )}>
              {dns ? (
                <>
                  <Check name="SPF" ok={dns.spf} okText={okText} />
                  <Check name="DKIM" ok={dns.dkim} okText={okText} />
                  <Check name="DMARC" ok={dns.dmarc} okText={okText} soft />
                  <span className="text-2xs text-slate-400">{t("Pichhla check", "Last check")}: {fmt(dns.at)}</span>
                </>
              ) : <span className="text-xs text-slate-500">{t(
                <>Abhi check nahi hua. <b className="font-medium text-slate-700">DNS check karo</b> dabao.</>,
                <>Not checked yet. Click <b className="font-medium text-slate-700">Check DNS</b>.</>,
              )}</span>}
            </StatusRow>
            <StatusRow label="Inbox sync" info={t(
              "Worker har 10 minute mein inbox apne aap sync karta hai (replies, bounce, opt-out). Abhi chahiye to 'Inbox abhi sync karo' dabao.",
              "The worker syncs the inbox by itself every 10 minutes (replies, bounces, opt-outs). Need it now? Click 'Sync inbox now'.",
            )}>
              <span className="text-xs text-slate-600">{st.lastSyncAt ? <>{t("Pichhla sync", "Last sync")}: {fmt(st.lastSyncAt)}</> : t("Abhi tak sync nahi hua", "Not synced yet")}</span>
            </StatusRow>
          </dl>
        </Section>

        {/* ---------- every setting is in this one form ---------- */}
        <ActionForm action={saveSettingsAction} ok={t("Settings save ho gayi", "Settings saved")} next={ready ? "/" : "#check"}
          nextCta={ready ? t("Dashboard pe jao", "Go to dashboard") : t("Ab connection test karo", "Now test the connection")} className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Section id="mailbox" className="scroll-mt-20 lg:col-span-2" icon="mail" title="Mailbox (SMTP / IMAP)"
              info={t(
                "Aapka email account: SMTP se mails jaati hain, IMAP se inbox padha jaata hai (replies, bounce, opt-out). Hostinger ke host aur port pehle se bhare hain, aam taur pe sirf apna email daalna hota hai.",
                "Your email account: mails go out over SMTP and the inbox is read over IMAP (replies, bounces, opt-outs). Hostinger's hosts and ports are already filled in; usually you only need to enter your email.",
              )}
              sub={t("Mail bhejne aur inbox padhne wala account", "The account that sends mail and reads the inbox")}>
              <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
                <div className="min-w-0">
                  <h3 className={SUBHEAD}><Icon name="send" size={12} />{t("SMTP · mail bhejna", "SMTP · sending mail")}</h3>
                  <div className="space-y-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                      <Field label="SMTP host" info={t("Mail bhejne wala server.", "The server that sends mail.")} hint="Hostinger: smtp.hostinger.com"><Txt name="smtpHost" value={s.smtpHost} plain /></Field>
                      <Field label="Port" info={t("465 = SSL (neeche SSL switch on). 587 = STARTTLS (SSL switch off).", "465 = SSL (SSL switch below on). 587 = STARTTLS (SSL switch off).")}><Num name="smtpPort" value={s.smtpPort} /></Field>
                    </div>
                    <Toggle name="smtpSecure" checked={s.smtpSecure} title="SSL/TLS" text="465 = SSL (on) · 587 = STARTTLS (off)"
                      info={t(
                        "Port 465 ke saath on rakho. Port 587 (STARTTLS) ke saath off rakho, wahan connection baad mein encrypt hota hai.",
                        "Keep it on with port 465. Keep it off with port 587 (STARTTLS), where the connection is encrypted after it opens.",
                      )} />
                    <Field label="SMTP user" info={t("Mailbox ka login naam. Khaali chhodo to From address hi login ban jaata hai.", "The mailbox login name. Leave it empty and the From address is used as the login.")}
                      hint={t("Aam taur pe aapka email", "Usually your email")}><Txt name="smtpUser" value={s.smtpUser} plain mode="email" /></Field>
                  </div>
                </div>
                <div className="min-w-0">
                  <h3 className={SUBHEAD}><Icon name="inbox" size={12} />{t("IMAP · inbox padhna", "IMAP · reading the inbox")}</h3>
                  <div className="space-y-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                      <Field label="IMAP host" info={t("Inbox padhne wala server. Replies, bounce aur opt-out isi se pakde jaate hain.", "The server that reads the inbox. Replies, bounces and opt-outs are picked up through it.")}
                        hint="Hostinger: imap.hostinger.com"><Txt name="imapHost" value={s.imapHost} plain /></Field>
                      <Field label="Port" info={t("993 = SSL. Hostinger pe 993 hi rakho.", "993 = SSL. On Hostinger, keep 993.")}><Num name="imapPort" value={s.imapPort} /></Field>
                    </div>
                    <Toggle name="imapSecure" checked={s.imapSecure} title="SSL/TLS" text="993 = SSL (on)"
                      info={t("Inbox ka connection encrypted rehta hai. Port 993 ke saath on rakho.", "Keeps the inbox connection encrypted. Keep it on with port 993.")} />
                    <Field label="IMAP user" info={t("Inbox ka login. Aam taur pe SMTP wala hi hota hai, isliye khaali chhod sakte ho.", "The inbox login. It is usually the same as SMTP, so you can leave it empty.")}
                      hint={t("Khaali = SMTP user", "Empty = SMTP user")}><Txt name="imapUser" value={s.imapUser} plain mode="email" /></Field>
                  </div>
                </div>
              </div>

              <div className="mt-6 border-t border-slate-100 pt-5">
                <h3 className={SUBHEAD}><Icon name="mail-check" size={12} />{t("Email address", "Email addresses")}</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="From address" info={t(
                    "Leads ko mail isi address se jaati hai. Ye aapke apne domain ka hona chahiye, DNS check isi domain ka hota hai.",
                    "Mail to leads goes out from this address. It must be on your own domain; the DNS check runs on this domain.",
                  )} hint={req(t, s.fromEmail, t("Mail isi address se jayegi", "Mail will go out from this address"))}>
                    <Txt name="fromEmail" value={s.fromEmail} plain mode="email" warn={!s.fromEmail} />
                  </Field>
                  <Field label="Test address" info={t(
                    "Aapka apna personal email. DRY-RUN mode mein har mail sirf yahan aati hai, aur 'Test mail mujhe bhejo' bhi yahin aati hai.",
                    "Your own personal email. In DRY-RUN mode every mail comes only here, and 'Send test mail to me' also sends here.",
                  )} hint={req(t, s.testEmail, t("Dry-run aur test mails isi pe aati hain", "Dry-run and test mails come here"))}>
                    <Txt name="testEmail" value={s.testEmail} plain mode="email" warn={!s.testEmail} />
                  </Field>
                  <Field label="Alert address" info={t(
                    "Sending apne aap ruk jaaye (auto-pause), kisi lead ka reply aaye, ya daily report bane: notification is address pe aata hai. Khaali = Test address. Dono khaali hon to ye mails kahin nahi jaati.",
                    "When sending pauses by itself (auto-pause), a lead replies or the daily report is made, the notification goes to this address. Empty = Test address. If both are empty, these mails go nowhere.",
                  )}
                    hint={noAlertTo
                      ? t(
                        <><span className="font-semibold text-amber-600">Abhi auto-pause, reply aur daily report ki mail kahin nahi jaati.</span> Alert ya Test address bharo.</>,
                        <><span className="font-semibold text-amber-600">Auto-pause, reply and daily report mails go nowhere right now.</span> Fill in Alert or Test address.</>,
                      )
                      : t("Auto-pause, replies aur daily report yahan aate hain", "Auto-pause, replies and daily report come here")}>
                    <Txt name="alertEmail" value={s.alertEmail} plain mode="email" warn={noAlertTo} />
                  </Field>
                </div>
              </div>
              <p className="mt-5 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
                <Icon name="lock" size={13} className="mt-px text-slate-400" />
                <span>{t(
                  <>Passwords sirf server ki .env file se aate hain (<code className={CODE}>SMTP_PASSWORD</code>, <code className={CODE}>IMAP_PASSWORD</code>, <code className={CODE}>AI_API_KEY</code>). Yahan password nahi daalna.</>,
                  <>Passwords come only from the server&apos;s .env file (<code className={CODE}>SMTP_PASSWORD</code>, <code className={CODE}>IMAP_PASSWORD</code>, <code className={CODE}>AI_API_KEY</code>). Do not enter passwords here.</>,
                )}</span>
              </p>
            </Section>

            <Section id="profile" className="scroll-mt-20" icon="user" title="Sender profile (signature)"
              info={t(
                "Har mail ke neeche signature aur footer app khud lagata hai, AI nahi. Yahan wahi bharo jo leads ko dikhna chahiye. ‘Inbox mein naam’ wo naam hai jisse har lead ko mail inbox aur notification mein dikhti hai. Neeche preview mein dekho mail ke end mein kya jaata hai.",
                "The app adds the signature and footer under every mail itself, not the AI. Fill in what leads should see. ‘Name in the inbox’ is the name every lead sees the mail from in their inbox and notifications. The preview below shows what goes at the end of each mail.",
              )}
              sub={t("Inbox mein dikhne wala naam aur har mail ke neeche ka signature", "The name shown in the inbox and the signature under every mail")}>
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("Naam", "Name")} info={t(
                    "Signature ki pehli line. Templates mein {{my_name}} isi se bharta hai. Inbox mein ye naam tabhi dikhta hai jab ‘Inbox mein naam’ aur Business dono khaali hon.",
                    "The first line of the signature. In templates, {{my_name}} is filled with it. The inbox shows this name only when ‘Name in the inbox’ and Business are both empty.",
                  )}
                    hint={sameName
                      ? <span className="text-amber-700">{t(
                        `Naam aur Business same hain, isliye templates mein ‘I'm ${s.business.trim()} from ${s.business.trim()}’ banta hai. Yahan apna naam likho; inbox mein phir bhi ${inboxName} hi dikhega.`,
                        `Name and Business are the same, so templates say ‘I'm ${s.business.trim()} from ${s.business.trim()}’. Put your own name here; the inbox still shows ${inboxName}.`,
                      )}</span>
                      : req(t, s.senderName, t("Signature ki pehli line", "First line of the signature"))}>
                    <Txt name="senderName" value={s.senderName} warn={!s.senderName || sameName} />
                  </Field>
                  <Field label="Role" info={t("Signature mein naam ke neeche dikhta hai.", "Shown under the name in the signature.")} hint={t("Jaise: Web designer", "e.g. Web designer")}><Txt name="senderRole" value={s.senderRole} /></Field>
                  <Field label="Business" info={t(
                    "Aapki company ka naam, jaise Brighton Solution. Signature mein role ke saath dikhta hai aur templates mein {{my_business}} isi se bharta hai. ‘Inbox mein naam’ khaali ho to leads ko mail isi naam se dikhti hai. Khaali ho to AI aapko freelancer maan ke likhta hai.",
                    "Your company's name, e.g. Brighton Solution. Shown next to the role in the signature, and {{my_business}} in templates is filled with it. When ‘Name in the inbox’ is empty, leads see the mail from this name. If empty, the AI writes as if you are a freelancer.",
                  )}
                    hint={t("Inbox ka default naam bhi yahi · khaali = freelance", "Also the default inbox name · empty = freelance")}><Txt name="business" value={s.business} /></Field>
                  <Field label={t("Inbox mein naam (From name)", "Name in the inbox (From name)")} info={t(
                    "Har lead ko inbox aur phone notification mein mail isi naam se dikhti hai, jaise ‘Brighton Solution’. Khaali chhodo to Business ka naam use hota hai; wo bhi khaali ho to aapka Naam. Mail ka address wahi From address rehta hai.",
                    "Every lead sees the mail from this name in their inbox and phone notifications, e.g. ‘Brighton Solution’. Leave it empty to use the Business name; if that is empty too, your Name. The mail address stays the From address.",
                  )}
                    hint={inboxName
                      ? t(<>Khaali = Business ka naam · Abhi inbox mein: <b className="font-semibold text-slate-600">{inboxName}</b></>, <>Empty = Business name · Inbox now shows: <b className="font-semibold text-slate-600">{inboxName}</b></>)
                      : t("Khaali = Business ka naam", "Empty = Business name")}>
                    <Txt name="fromName" value={s.fromName} placeholder={s.business || "Brighton Solution"} />
                  </Field>
                  <Field className="sm:col-span-2" label="Website" info={t("Signature mein aapki website ka link.", "A link to your website in the signature.")} hint={t("Jaise: https://aapki-site.com", "e.g. https://your-site.com")}><Txt name="website" value={s.website} plain mode="url" /></Field>
                </div>
                <Field label="Portfolio links" info={t("Signature mein website ke neeche dikhte hain. Ek line mein ek link.", "Shown under the website in the signature. One link per line.")} hint={t("Ek line mein ek link", "One link per line")}>
                  <textarea name="portfolio" defaultValue={s.portfolio} rows={3} className="input" {...PLAIN} />
                </Field>
                <Field label="Postal address" info={t(
                  "Har mail ke footer mein dikhta hai. Cold email ke law (jaise CAN-SPAM) ke hisaab se ye zaroori hai.",
                  "Shown in the footer of every mail. Cold email laws (like CAN-SPAM) require it.",
                )} hint={req(t, s.postalAddress, t("Footer mein dikhta hai (law ke hisaab se zaroori)", "Shown in the footer (required by law)"))}>
                  <textarea name="postalAddress" defaultValue={s.postalAddress} rows={2} className={`input ${!s.postalAddress ? WARN_INPUT : ""}`} />
                </Field>
                <Toggle name="signatureLogo" checked={s.signatureLogo} title={t("Signature mein logo", "Logo in signature")}
                  text={t("Off = sirf plain text, naye domain ke liye sabse safe", "Off = plain text only, safest for a new domain")}
                  info={t(
                    "On karne pe mail HTML mein jaati hai aur signature ke neeche chhota logo dikhta hai. Logo mail ke andar hi hota hai, bahar se load nahi hota. Naye domain ke warm-up mein off rakhna sabse safe hai.",
                    "When on, mail goes out as HTML with a small logo under the signature. The logo is embedded in the mail itself, not loaded from outside. Keeping it off while a new domain warms up is the safest.",
                  )} />
                <details className="group rounded-lg border border-slate-200">
                  <summary className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition hover:text-slate-900">
                    <Icon name="eye" size={14} className="text-slate-400" />{t("Signature preview dekho", "Show signature preview")}
                    <Icon name="chevron-down" size={14} className="ml-auto text-slate-400 transition group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-slate-100 px-3 py-3">
                    {sig
                      ? <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-slate-800">{sig}</pre>
                      : <p className="text-xs text-slate-500">{t("Signature abhi khaali hai. Naam bharo aur save karo.", "The signature is empty. Fill in Name and save.")}</p>}
                    <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-2xs leading-relaxed text-slate-400">{footer("en", "[source]", s.postalAddress)}</pre>
                    <p className="hint">{t(
                      "Saved settings se bana hai. Footer lead ki bhasha mein jaata hai, aur [source] ki jagah lead kahan se mila wo aata hai.",
                      "Built from the saved settings. The footer goes out in the lead's language, and [source] becomes where the lead was found.",
                    )}</p>
                  </div>
                </details>
              </div>
            </Section>

            {/* flex column: next to the taller Sender profile card the two big boxes grow instead of leaving a blank gap */}
            <Section id="offer" className="scroll-mt-20 flex flex-col" icon="bulb" title={t("Offer notes (AI ke liye)", "Offer notes (for the AI)")}
              info={t(
                "AI har mail likhte waqt sirf yahi baatein use karta hai. Sirf sach likho: jo yahan nahi likha, AI wo claim nahi karta. Chhota aur seedha rakho.",
                "The AI uses only these points when it writes each mail. Write only true facts: the AI never claims anything that is not written here. Keep it short and direct.",
              )}
              sub={t("AI sirf yahi sach baatein use karta hai", "The AI uses only these true facts")}>
              <div className="flex flex-1 flex-col gap-4">
                <Field className="flex flex-1 flex-col" label={t("Aap kya offer karte ho", "What you offer")} info={t("Aapki service 1-2 line mein. Har mail ka main point yahi banta hai.", "Your service in 1-2 lines. This becomes the main point of every mail.")}
                  hint={t("1-2 line, seedhi bhasha mein", "1-2 lines, in plain words")}>
                  <textarea name="offerWhat" defaultValue={s.offerWhat} rows={4} className="input flex-1" />
                </Field>
                <Field className="flex flex-1 flex-col" label={t("Proof points (sirf sach)", "Proof points (true facts only)")}
                  info={t(
                    "Asli results, clients ya experience. AI inhe tabhi use karta hai jab lead ke liye relevant ho, aur kabhi badha-chadha ke nahi.",
                    "Real results, clients or experience. The AI uses them only when they are relevant to the lead, and never exaggerates them.",
                  )}
                  hint={t("Khaali = AI koi proof claim nahi karega", "Empty = the AI will not claim any proof")}>
                  <textarea name="offerProof" defaultValue={s.offerProof} rows={4} placeholder={t("Jaise: 5 saal ka experience, 40+ small business websites", "e.g. 5 years of experience, 40+ small business websites")} className="input flex-1" />
                </Field>
                <Field label="Tone" info={t("Mail kis andaaz mein likhi jaaye.", "The style the mail should be written in.")} hint={t("Jaise: Friendly, short, honest, no hype", "e.g. Friendly, short, honest, no hype")}>
                  <textarea name="offerTone" defaultValue={s.offerTone} rows={2} className="input" />
                </Field>
              </div>
            </Section>

            <Section id="templates" className="scroll-mt-20 lg:col-span-2" icon="file" title="Email templates"
              info={t(
                "Teen fixed mails, jo campaign AI ki jagah use kar sakta hai: campaign banate waqt ‘Mail kaise banegi’ mein Template 1, 2 ya 3 chuno. Sabko same text jaata hai, har lead ke liye sirf placeholders (business ka naam, contact, city…) bharte hain. Template mails bhi same rules aur same approval se guzarti hain. Badalne ke baad ‘Settings save karo’ dabao: nayi drafts naye text se banengi, pehle bani drafts nahi badalti.",
                "Three fixed mails a campaign can use instead of the AI: choose Template 1, 2 or 3 under ‘How mails are written’ when you create a campaign. Everyone gets the same text; for each lead only the placeholders (business name, contact, city…) are filled in. Template mails go through the same rules and the same approval. After a change, click ‘Save settings’: new drafts use the new text, drafts made earlier do not change.",
              )}
              sub={t("AI ki jagah fixed text: sabko same mail, sirf naam aur details badalti hain", "Fixed text instead of the AI: the same mail for everyone, only names and details change")}>
              <div className="space-y-5">
                <div className="grid gap-x-8 gap-y-5 rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 md:grid-cols-2">
                  <div className="min-w-0">
                    <h3 className={SUBHEAD}><Icon name="list" size={12} />Placeholders
                      <Info title="Placeholders" size={12} text={t(
                        "Text ya subject mein ye likho, har lead ke liye app inki jagah lead ki detail bharta hai. CSV wali details import file se aati hain (jis lead ki detail nahi, uske liye khaali). Aapke naam aur business Sender profile se aate hain.",
                        "Write these in the text or subject; for each lead the app puts the lead's detail in their place. The CSV details come from the import file (empty when a lead does not have them). Your name and business come from Sender profile.",
                      )} />
                    </h3>
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-xs">
                      {PLACEHOLDERS.map((p) => (
                        <Fragment key={p.k}>
                          <dt><code className={CODE}>{`{{${p.k}}}`}</code></dt>
                          <dd className="min-w-0 text-slate-600">{t(p.hi, p.en)}</dd>
                        </Fragment>
                      ))}
                    </dl>
                    <p className="mt-3 border-t border-slate-200/80 pt-3 text-xs leading-relaxed text-slate-600">
                      <code className={CODE}>{"{{x|text}}"}</code>
                      {t(
                        <>: lead ki detail khaali ho to ‘text’ aata hai. Jaise <code className={CODE}>{"Hello {{contact|there}},"}</code> → contact ho to <b className="font-medium text-slate-800">Hello {EXAMPLE_LEAD.contactName},</b> warna <b className="font-medium text-slate-800">Hello there,</b></>,
                        <>: when the lead has no value, ‘text’ is used. E.g. <code className={CODE}>{"Hello {{contact|there}},"}</code> → <b className="font-medium text-slate-800">Hello {EXAMPLE_LEAD.contactName},</b> with a contact, otherwise <b className="font-medium text-slate-800">Hello there,</b></>,
                      )}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <h3 className={SUBHEAD}><Icon name="check-check" size={12} />{t("Rules (har mail pe check)", "Rules (checked on every mail)")}</h3>
                    <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-slate-600 marker:text-slate-300">
                      <li>{t("60 se 110 words (placeholders bharne ke baad)", "60 to 110 words (after the placeholders are filled in)")}</li>
                      <li>{t("Aakhir mein ek sawaal (?), jaise ‘Would it help if I sent you a few ideas?’", "End with a question (?), e.g. ‘Would it help if I sent you a few ideas?’")}</li>
                      <li>{t("Text mein koi link ya website address nahi (link sirf signature mein aata hai)", "No links or web addresses in the text (links only go in the signature)")}</li>
                      <li>{t("CAPS wale shabd, ‘urgent’, ‘guarantee’, ‘100%’, ‘!!’ aur HTML nahi", "No ALL CAPS words, ‘urgent’, ‘guarantee’, ‘100%’, ‘!!’ or HTML")}</li>
                      <li>{t("Subject 90 akshar tak, ‘Re:’ ya ‘Fwd:’ ke bina", "Subject up to 90 characters, without ‘Re:’ or ‘Fwd:’")}</li>
                      <li>{t("Campaign ki bhasha mein likho: French campaign ke liye French text, warna draft fail hota hai", "Write it in the campaign's language: French text for a French campaign, otherwise the draft fails")}</li>
                      <li>{t("Signature aur footer mat likho: app unhe Sender profile se khud lagata hai", "Do not write a signature or footer: the app adds them from Sender profile")}</li>
                      <li>{t("Sirf wahi likho jo har lead ke liye sach ho: ‘maine aapki website dekhi’ jaisi lines nahi", "Write only what is true for every lead: no lines like ‘I looked at your website’")}</li>
                    </ul>
                  </div>
                </div>
                <TemplateEditor templates={TEMPLATE_IDS.map((id) => templateOf(s, id))} senderName={s.senderName} business={s.business} />
              </div>
            </Section>

            <Section id="rules" className="scroll-mt-20 lg:col-span-2" icon="clock" title="Sending rules"
              info={t(
                "Mails kab aur kitni jaayengi: sirf chune hue dino mein, window ke andar, har mail ke beech random gap ke saath. Naya domain warm-up se dheere dheere badhta hai, taaki mails spam mein na jaayein.",
                "When and how many mails go out: only on the chosen days, inside the window, with a random gap between mails. A new domain ramps up slowly through warm-up, so mails do not land in spam.",
              )}
              sub={t("Kab, kitni aur kitne gap pe mails jaayengi", "When, how many and how far apart mails go out")}>
              <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
                <Group title={t("Sending din", "Sending days")} icon="calendar"
                  info={t(
                    "Sirf in dino mein mails jaati hain. Din campaign ke timezone (lead ke desh) ke hisaab se gine jaate hain. Weekend band rakhna safe hai.",
                    "Mails go out only on these days. Days follow the campaign's timezone (the lead's country). Keeping weekends off is safe.",
                  )}
                  hint={t("Campaign ke timezone ke hisaab se", "In the campaign's timezone")}>
                  <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                    {DAYS.map(([hi, en], i) => (
                      <label key={en} className="relative cursor-pointer">
                        <input type="checkbox" name="sendDays" value={i + 1} defaultChecked={s.sendDays.includes(i + 1)} className="peer sr-only" />
                        <span className="flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-2xs font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-800 peer-checked:border-indigo-600 peer-checked:bg-indigo-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 peer-focus-visible:ring-offset-1 xl:text-xs">{t(hi, en)}</span>
                      </label>
                    ))}
                  </div>
                </Group>
                <Group title="Sending window" icon="clock"
                  info={t(
                    "Roz sirf is samay ke beech mails jaati hain. Samay campaign ke timezone mein hai, aapke nahi, taaki mail lead ke office time mein pahunche.",
                    "Each day mails go out only between these times. The times are in the campaign's timezone, not yours, so mail arrives during the lead's office hours.",
                  )}
                  hint={t("Campaign ke timezone mein (lead ke desh ka samay)", "In the campaign's timezone (the lead's local time)")}>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t("Kab se", "Start")}><input name="windowStart" type="time" defaultValue={s.windowStart} className="input tabular-nums" /></Field>
                    <Field label={t("Kab tak", "End")}><input name="windowEnd" type="time" defaultValue={s.windowEnd} className="input tabular-nums" /></Field>
                  </div>
                </Group>
                <Group title={t("Do mails ke beech gap (minute)", "Gap between mails (minutes)")} icon="history"
                  info={t(
                    "Har mail ke baad random gap, kam se kam aur zyada se zyada ke beech. Isse sending insaan jaisi lagti hai aur spam filter shak nahi karte.",
                    "A random gap after every mail, between the minimum and the maximum. This makes sending look human, so spam filters do not get suspicious.",
                  )}
                  hint={t("Kam gap = tez sending, par spam ka risk zyada", "Shorter gap = faster sending, but a higher spam risk")}>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t("Kam se kam", "Minimum")}><Num name="gapMinMin" value={s.gapMinMin} /></Field>
                    <Field label={t("Zyada se zyada", "Maximum")}><Num name="gapMaxMin" value={s.gapMaxMin} /></Field>
                  </div>
                </Group>
                <Group title="Warm-up" icon="trending"
                  info={t(
                    "Naye domain ko dheere dheere badhao. Pehle sending din 'Pehla din' jitni mails, phir har sending din 'Har din +' jitni badhti hain, 'Max / din' tak.",
                    "Ramp up a new domain slowly. The first sending day sends 'Day one' mails, then each sending day adds '+ per day' more, up to 'Max / day'.",
                  )}
                  hint={t("Pehle din kitni, har sending din kitni badhengi, max kitni", "How many on day one, how many more per sending day, and the max")}>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label={t("Pehla din", "Day one")}><Num name="warmStart" value={s.warmStart} /></Field>
                    <Field label={t("Har din +", "+ per day")}><Num name="warmStep" value={s.warmStep} /></Field>
                    <Field label={t("Max / din", "Max / day")}><Num name="warmMax" value={s.warmMax} /></Field>
                  </div>
                </Group>
                <Group title="Mailbox plan" icon="server"
                  info={t(
                    "Aapke mailbox plan ki roz ki sending limit (Hostinger plan mein likhi hoti hai). Safety ke liye app iska 40% se zyada kabhi nahi bhejta. 0 = plan limit nahi lagegi, sirf warm-up.",
                    "Your mailbox plan's daily sending limit (listed in your Hostinger plan). For safety the app never sends more than 40% of it. 0 = no plan limit, only warm-up.",
                  )}
                  hint={s.planDailyLimit > 0
                    ? t(`Plan ka 40% se zyada kabhi nahi: ${planCap}/din`, `Never more than 40% of the plan: ${planCap}/day`)
                    : t("0 = sirf warm-up ki limit lagegi", "0 = only the warm-up limit applies")}>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t("Plan limit / din", "Plan limit / day")}><Num name="planDailyLimit" value={s.planDailyLimit} /></Field>
                  </div>
                </Group>
                <Group title={t("Roz kitni mails jaayengi", "Mails per day")} icon="activity"
                  info={t(
                    "Saved settings se: warm-up aur plan limit (40%) mein jo kam ho, roz utni hi mails jaati hain. 'Din' = asli sending din, jis din live mail gayi. Save karne ke baad ye update hota hai.",
                    "From the saved settings: each day, as many mails go out as the lower of warm-up and the plan limit (40%). 'Day' = a real sending day, one on which live mail went out. This updates after you save.",
                  )}
                  hint={ramp.steady
                    ? t(`Din ${ramp.days.length} se roz ${ramp.top}`, `From day ${ramp.days.length}: ${ramp.top} a day`)
                    : t(`Aage badhte badhte max ${ramp.top}/din tak`, `Keeps growing up to ${ramp.top}/day`)}>
                  <ol className="grid grid-cols-6 gap-1.5">
                    {ramp.days.map((n, i) => (
                      <li key={i} className={`rounded-lg px-1 py-1.5 text-center ring-1 ring-inset ${ramp.steady && i === ramp.days.length - 1 ? "bg-indigo-50 ring-indigo-200/70" : "bg-slate-50 ring-slate-200/70"}`}>
                        <div className="text-2xs text-slate-400">{t("Din", "Day")} {i + 1}{ramp.steady && i === ramp.days.length - 1 ? "+" : ""}</div>
                        <div className="text-sm font-semibold tabular-nums text-slate-800">{n}</div>
                      </li>
                    ))}
                  </ol>
                </Group>
              </div>

              {/* Mode (DRY-RUN / LIVE) and its Dashboard link live in the Connection test card: a link here, next to unsaved fields, invites leaving without saving */}
              <div className="mt-6 grid gap-3 border-t border-slate-100 pt-5 md:grid-cols-2">
                <Toggle name="approveEach" checked={s.approveEach} title={t("Har mail approve karke hi bhejo", "Approve every mail before sending")}
                  text={t("On = har mail 'Approve Karo' page pe rukti hai", "On = every mail waits on the 'Approve\u00a0mails' page")}
                  info={t(
                    "On (recommended): AI ki har mail 'Approve Karo' page pe rukti hai aur aapke approve karne ke baad hi jaati hai. Off: drafts apne aap approve ho jaate hain.",
                    "On (recommended): every AI mail waits on the 'Approve mails' page and goes out only after you approve it. Off: drafts are approved automatically.",
                  )} />
              </div>
            </Section>

            <Section id="ai" className="scroll-mt-20" icon="bot" title="AI (OpenAI-compatible)"
              info={t(
                "AI mail drafts likhta hai aur replies ka English translation karta hai. Koi bhi OpenAI-compatible service chalegi: OpenAI, Groq, OpenRouter. Badalne ke baad save karke 'AI test' dabao.",
                "The AI writes mail drafts and translates replies into English. Any OpenAI-compatible service works: OpenAI, Groq, OpenRouter. After a change, save and click 'AI test'.",
              )}
              sub={t("Drafts likhne aur replies translate karne ke liye", "For writing drafts and translating replies")}>
              <div className="space-y-4">
                <Field label="Base URL" info={t("AI service ka API address. Apni service ka URL neeche ke examples se copy karo.", "The AI service's API address. Copy your service's URL from the examples below.")}
                  hint={<span className="flex flex-wrap items-center gap-1">{t("Jaise:", "e.g.")}{AI_URLS.map((u) => <code key={u} className={`${CODE} break-all`}>{u}</code>)}</span>}>
                  <Txt name="aiBaseUrl" value={s.aiBaseUrl} plain mode="url" />
                </Field>
                <Field label="Model" info={t("Kaunsa model mail likhe. Sasta aur tez model kaafi hai.", "Which model writes the mails. A cheap, fast model is enough.")} hint={t("Jaise: gpt-4o-mini", "e.g. gpt-4o-mini")}><Txt name="aiModel" value={s.aiModel} plain /></Field>
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
                  <Icon name="lock" size={13} className="text-slate-400" />
                  <span className="min-w-0 flex-1">{t(
                    <>API key server ki .env mein <code className={CODE}>AI_API_KEY</code> se aati hai</>,
                    <>The API key comes from <code className={CODE}>AI_API_KEY</code> in the server&apos;s .env</>,
                  )}</span>
                  <Badge v={envOk.ai ? "ok" : "missing"} label={envOk.ai ? setText : "missing"} tone={envOk.ai ? "emerald" : "red"} />
                </div>
              </div>
            </Section>

            <Section id="dns" className="scroll-mt-20" icon="shield" title="Domain health (DNS)"
              info={t(
                "Mail inbox mein pahunche, spam mein nahi: iske liye domain ke DNS records chahiye. SPF aur DKIM zaroori hain, inke bina campaign start nahi hota. DMARC optional hai par achha hai. Records Hostinger hPanel ke DNS Zone mein milte hain.",
                "For mail to reach the inbox and not spam, the domain needs DNS records. SPF and DKIM are required; without them a campaign cannot start. DMARC is optional but good to have. You find the records in the DNS Zone of Hostinger hPanel.",
              )}
              sub={t("SPF, DKIM aur DMARC records", "SPF, DKIM and DMARC records")}>
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Sending domain" info={t("Jis domain se mail jaati hai. Khaali chhodo to From address ka domain le liya jaata hai.", "The domain mail goes out from. Leave it empty to use the From address's domain.")}
                    hint={t("Khaali = From address ka domain", "Empty = domain of the From address")}>
                    <Txt name="domain" value={s.domain} plain placeholder={s.fromEmail.split("@")[1] || t("aapka-domain.com", "your-domain.com")} />
                  </Field>
                  <Field label="DKIM selector" info={t(
                    "DKIM record ka naam: selector._domainkey.aapka-domain. Hostinger pe aam taur pe hostingermail-a hota hai.",
                    "The DKIM record's name: selector._domainkey.your-domain. On Hostinger it is usually hostingermail-a.",
                  )} hint={t("Hostinger: hostingermail-a (ya -b, -c)", "Hostinger: hostingermail-a (or -b, -c)")}>
                    <Txt name="dkimSelector" value={s.dkimSelector} plain />
                  </Field>
                </div>
                {dns ? (
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
                      <Check name="SPF" ok={dns.spf} okText={okText} />
                      <Check name="DKIM" ok={dns.dkim} okText={okText} />
                      <Check name="DMARC" ok={dns.dmarc} okText={okText} soft />
                      <span className="text-2xs text-slate-400 sm:ml-auto">{fmt(dns.at)}</span>
                    </div>
                    <pre className="whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-2xs leading-relaxed text-slate-600">{dns.detail}</pre>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
                    {t(
                      <>DNS abhi check nahi hua. Save karke upar <a href="#check" className="link">DNS check karo</a> dabao.</>,
                      <>DNS has not been checked yet. Save, then click <a href="#check" className="link">Check DNS</a> above.</>,
                    )}
                  </div>
                )}
                {dnsBad && (
                  <Callout tone="warn" title={t("Campaign start nahi hoga", "Campaigns cannot start")} action={<a href="#check" className="btn btn-sm">{t("Dobara check karo", "Check again")}</a>}>
                    {t(
                      <>Hostinger hPanel ke DNS Zone mein {dnsFix} record theek karo, phir DNS dobara check karo.</>,
                      <>Fix {dnsFix} in the DNS Zone of Hostinger hPanel, then check DNS again.</>,
                    )}
                  </Callout>
                )}
              </div>
            </Section>
          </div>

          {/* on desktop the button sits on the left: toasts appear bottom-right and would cover it */}
          <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+68px)] z-20 flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2.5 shadow-pop backdrop-blur sm:px-4 lg:bottom-4">
            <p className="flex min-w-0 flex-1 items-center gap-2 text-xs text-slate-600 sm:text-sm">
              <Icon name="info" size={15} className="hidden text-indigo-500 sm:block" />{t("Badlaav karne ke baad save karna mat bhoolo", "Don't forget to save after making\u00a0changes")}
            </p>
            <SubmitButton className="btn-primary shrink-0 lg:order-first" icon="check" pendingText={t("Save ho raha hai…", "Saving…")}>{t("Settings save karo", "Save settings")}</SubmitButton>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}
