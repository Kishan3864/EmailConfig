import { getSettings, getState } from "@/lib/settings";
import { saveSettingsAction, testSmtpAction, testImapAction, testMailAction, testAiAction, dnsAction, syncNowAction } from "../actions";
import { ActionButton } from "@/components/ActionButton";
import { fmt } from "@/lib/time";

function F({ name, label, value, type = "text", hint }: { name: string; label: string; value: string | number; type?: string; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input name={name} defaultValue={value} type={type} className="input" />
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
function T({ name, label, value }: { name: string; label: string; value: string }) {
  return <label className="block"><span className="label">{label}</span><textarea name={name} defaultValue={value} rows={3} className="input" /></label>;
}
function C({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={checked} /> {label}</label>;
}

export default async function SettingsPage() {
  const s = await getSettings();
  const st = await getState();
  const envOk = { smtp: !!process.env.SMTP_PASSWORD, ai: !!process.env.AI_API_KEY };
  return (
    <div className="space-y-6">
      <h1 className="h1">Settings</h1>
      <div className="card flex flex-wrap gap-4 items-start">
        <ActionButton action={testSmtpAction} label="Test SMTP" />
        <ActionButton action={testImapAction} label="Test IMAP" />
        <ActionButton action={testMailAction} label="Send test mail to me" />
        <ActionButton action={testAiAction} label="Test AI" />
        <ActionButton action={dnsAction} label="Check DNS (SPF/DKIM/DMARC)" />
        <ActionButton action={syncNowAction} label="Sync inbox now" />
        <div className="text-xs text-slate-500 ml-auto">
          .env: SMTP_PASSWORD {envOk.smtp ? "✓" : "✗ missing"} · AI_API_KEY {envOk.ai ? "✓" : "✗ missing"}
          {st.dns && <div className="mt-1">DNS ({fmt(st.dns.at)}): SPF {st.dns.spf ? "✓" : "✗"} · DKIM {st.dns.dkim ? "✓" : "✗"} · DMARC {st.dns.dmarc ? "✓" : "✗"}</div>}
        </div>
      </div>

      <form action={saveSettingsAction} className="space-y-6">
        <div className="grid md:grid-cols-2 gap-6">
          <section className="card space-y-3">
            <h2 className="h2">Mailbox</h2>
            <div className="grid grid-cols-3 gap-2"><div className="col-span-2"><F name="smtpHost" label="SMTP host" value={s.smtpHost} /></div><F name="smtpPort" label="Port" value={s.smtpPort} type="number" /></div>
            <C name="smtpSecure" label="SMTP SSL/TLS" checked={s.smtpSecure} />
            <F name="smtpUser" label="SMTP user (usually your email)" value={s.smtpUser} />
            <div className="grid grid-cols-3 gap-2"><div className="col-span-2"><F name="imapHost" label="IMAP host" value={s.imapHost} /></div><F name="imapPort" label="Port" value={s.imapPort} type="number" /></div>
            <C name="imapSecure" label="IMAP SSL/TLS" checked={s.imapSecure} />
            <F name="imapUser" label="IMAP user (blank = SMTP user)" value={s.imapUser} />
            <F name="fromEmail" label="From address" value={s.fromEmail} />
            <F name="testEmail" label="My test address (dry-run + test mails)" value={s.testEmail} />
            <F name="alertEmail" label="Alert / notification address" value={s.alertEmail} />
            <p className="text-xs text-slate-400">Passwords are read from .env only (SMTP_PASSWORD, IMAP_PASSWORD).</p>
          </section>

          <section className="card space-y-3">
            <h2 className="h2">Sender profile</h2>
            <F name="senderName" label="Name" value={s.senderName} />
            <F name="senderRole" label="Role" value={s.senderRole} />
            <F name="business" label="Business" value={s.business} />
            <F name="website" label="Website" value={s.website} />
            <T name="portfolio" label="Portfolio links (one per line)" value={s.portfolio} />
            <T name="postalAddress" label="Postal address (in footer)" value={s.postalAddress} />
          </section>

          <section className="card space-y-3">
            <h2 className="h2">Offer notes (used by the AI)</h2>
            <T name="offerWhat" label="What I sell" value={s.offerWhat} />
            <T name="offerProof" label="Proof points (true facts only)" value={s.offerProof} />
            <T name="offerTone" label="Tone" value={s.offerTone} />
          </section>

          <section className="card space-y-3">
            <h2 className="h2">Sending rules</h2>
            <div className="flex flex-wrap gap-3 text-sm">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
                <label key={d} className="flex items-center gap-1"><input type="checkbox" name="sendDays" value={i + 1} defaultChecked={s.sendDays.includes(i + 1)} />{d}</label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <F name="windowStart" label="Window start (campaign tz)" value={s.windowStart} type="time" />
              <F name="windowEnd" label="Window end" value={s.windowEnd} type="time" />
              <F name="gapMinMin" label="Min gap (minutes)" value={s.gapMinMin} type="number" />
              <F name="gapMaxMin" label="Max gap (minutes)" value={s.gapMaxMin} type="number" />
              <F name="warmStart" label="Warm-up: day one" value={s.warmStart} type="number" />
              <F name="warmStep" label="+ per sending day" value={s.warmStep} type="number" />
              <F name="warmMax" label="Max per day" value={s.warmMax} type="number" />
              <F name="planDailyLimit" label="Mailbox plan daily limit" value={s.planDailyLimit} type="number" hint={`Never more than 40% = ${Math.floor(s.planDailyLimit * 0.4)}/day`} />
            </div>
            <C name="dryRun" label="DRY-RUN mode (deliver only to my test address)" checked={s.dryRun} />
          </section>

          <section className="card space-y-3">
            <h2 className="h2">AI (OpenAI-compatible)</h2>
            <F name="aiBaseUrl" label="Base URL" value={s.aiBaseUrl} hint="e.g. https://api.openai.com/v1, https://api.groq.com/openai/v1, https://openrouter.ai/api/v1" />
            <F name="aiModel" label="Model" value={s.aiModel} />
            <p className="text-xs text-slate-400">API key is read from .env (AI_API_KEY).</p>
          </section>

          <section className="card space-y-3">
            <h2 className="h2">Domain health</h2>
            <F name="domain" label="My sending domain" value={s.domain} hint="blank = domain of From address" />
            <F name="dkimSelector" label="DKIM selector" value={s.dkimSelector} hint="Hostinger usually: hostingermail1 (also -2, -3)" />
            {st.dns && <pre className="text-xs bg-slate-50 p-2 rounded whitespace-pre-wrap">{st.dns.detail}</pre>}
          </section>
        </div>
        <button className="btn-primary">Save settings</button>
      </form>
    </div>
  );
}
