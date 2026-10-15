import Link from "next/link";
import { C, rows, type SendLog, type LogRow } from "@/lib/fsdb";
import { Badge, Callout, EmptyState, NextStep, PageHeader, Section } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { fmt } from "@/lib/time";

export const metadata = { title: "Logs" };

const VIEW: Record<"logs" | "errors" | "smtp", { title: string; icon: IconName; info: string }> = {
  logs: {
    title: "App log",
    icon: "activity",
    info: "App aur worker ne jo bhi kiya uska record: settings save, import, campaign, mail bhejna, inbox sync waghera. Level batata hai kitna zaroori hai: Info = normal, Warning = dhyan do, Error = kuch fail hua. Scope batata hai ki entry app ke kis hisse se aayi.",
  },
  errors: {
    title: "Sirf errors",
    icon: "x-circle",
    info: "Sirf Error level wali entries, jahan kuch fail hua. Message padho: zyada tar mein wajah likhi hoti hai (jaise SMTP login fail ya AI key galat). Theek karne ke baad Settings mein Test button se check karo. Warnings (jaise retry hone wali fail mails) yahan nahi, 'App log' tab mein dikhti hain.",
  },
  smtp: {
    title: "SMTP jawab",
    icon: "server",
    info: "Har mail bhejne pe mail server ne jo jawab diya, wo yahan hai. 250 se shuru hone wala jawab matlab server ne mail le li. 4xx matlab abhi nahi (baad mein retry hota hai), 5xx matlab server ne mana kar diya. Mode batata hai ki mail Dry-run thi (sirf test address pe) ya Live.",
  },
};

export default async function Logs({ searchParams }: { searchParams: Promise<{ tab?: string; level?: string }> }) {
  const { tab = "logs", level } = await searchParams;
  const sends = tab === "smtp" ? rows<SendLog>(await C.sendLogs.orderBy("at", "desc").limit(500).get()) : [];
  const logs = tab === "smtp" ? [] : rows<LogRow>(await (level ? C.logs.where("level", "==", level) : C.logs).orderBy("at", "desc").limit(500).get());

  const smtp = tab === "smtp";
  const errorsOnly = !smtp && level === "error";
  const view = VIEW[smtp ? "smtp" : errorsOnly ? "errors" : "logs"];
  const tabs = [
    { href: "/logs", ...VIEW.logs, on: !smtp && !level },
    { href: "/logs?level=error", ...VIEW.errors, on: errorsOnly },
    { href: "/logs?tab=smtp", ...VIEW.smtp, on: smtp },
  ];
  const n = smtp ? sends.length : logs.length;
  const errs = logs.filter((l) => l.level === "error").length;
  const warns = logs.filter((l) => l.level === "warn").length;
  const fails = sends.filter((s) => !s.ok).length;
  const lastErr = errorsOnly ? undefined : logs.find((l) => l.level === "error"); // newest first
  const sub = n === 0 ? "Koi record nahi"
    : smtp ? `${n} jawab · ${fails} fail`
    : errorsOnly || level ? `${n} record${n >= 500 ? " (sirf sabse naye)" : ""}`
    : `${n} record · ${warns} warning · ${errs} error${n >= 500 ? " (sabse naye 500 mein)" : ""}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Logs"
        info="Yahan app aur worker ka poora record hai: kya hua, kab hua, aur koi problem aayi to kya. 'Sirf errors' tab mein sirf Error level wali entries dikhti hain. 'SMTP jawab' tab mein har bheji mail pe mail server ka asli jawab milta hai."
        sub="App, worker aur mail server ka record · naya sabse upar"
        actions={
          <nav className="seg" aria-label="Log ke tab">
            {tabs.map((t) => (
              <Link key={t.href} href={t.href} aria-current={t.on ? "page" : undefined} className={`seg-item ${t.on ? "seg-item-on" : ""}`}>
                <Icon name={t.icon} size={13} />{t.title}
              </Link>
            ))}
          </nav>
        }
      />

      {lastErr && (
        <Callout tone="warn" title={`Is list mein ${errs} error ${errs === 1 ? "hai" : "hain"}`}
          action={<Link href="/logs?level=error" className="btn btn-sm"><Icon name="x-circle" size={14} />Sirf errors dekho</Link>}>
          Sabse naya error {fmt(lastErr.at)} ko aaya ({lastErr.scope}). Samajh na aaye to Settings mein Test buttons se check karo.
        </Callout>
      )}
      {smtp && fails > 0 && (
        <Callout tone="warn" title={`${fails} mail server ne nahi li`}>
          Neeche &apos;Fail&apos; wali line ka server jawab padho. 4xx matlab baad mein retry hoga, 5xx matlab server ne mana kar diya.
        </Callout>
      )}

      <Section flush title={view.title} icon={view.icon} info={view.info} sub={sub}>
        {n === 0 ? (
          smtp ? <EmptyState icon="server" title="Abhi koi SMTP jawab nahi hai" text="Jab koi mail jayegi, mail server ka jawab yahan dikhega." href="/review" cta="Mails approve karo" />
          : errorsOnly ? <EmptyState icon="check-circle" title="Koi error nahi hai" text="Abhi tak koi error record nahi hua." />
          : <EmptyState icon="activity" title="Abhi koi log nahi hai" text="Jaise hi app kuch karega (settings save, import, mail bhejna), uska record yahan dikhega." href="/settings" cta="Settings se shuru karo" />
        ) : smtp ? (
          <div className="overflow-x-auto">
            <table className="tbl tbl-stack">
              <thead><tr><th>Samay</th><th>Kisko</th><th>Result</th><th>Mode</th><th>Server ka jawab</th></tr></thead>
              <tbody>
                {sends.map((s) => (
                  <tr key={s.id}>
                    {/* phone: this cell is the card title (address + time) */}
                    <td className="text-slate-500">
                      <div className="flex min-w-0 flex-1 items-start justify-between gap-3 md:hidden">
                        <span className="min-w-0 break-all font-medium text-slate-900">{s.to}</span>
                        <span className="shrink-0 text-xs">{fmt(s.at)}</span>
                      </div>
                      <span className="whitespace-nowrap max-md:hidden">{fmt(s.at)}</span>
                    </td>
                    <td data-label="Kisko" className="break-all font-medium text-slate-900 max-md:!hidden">{s.to}</td>
                    <td data-label="Result"><Badge v={s.ok ? "sent" : "failed"} /></td>
                    <td data-label="Mode"><Badge v={s.dryRun ? "dry-run" : "live"} /></td>
                    <td>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 text-xs font-medium text-slate-400 md:hidden">Server ka jawab</div>
                        <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{s.response || "—"}</div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl tbl-stack">
              <thead><tr><th>Samay</th><th>Level</th><th>Scope</th><th>Message</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    {/* phone: this cell is the card title (level, scope, time) */}
                    <td className="text-slate-500">
                      <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
                        <Badge v={l.level} /><span className="min-w-0 truncate font-mono text-xs text-slate-600">{l.scope}</span>
                        <span className="ml-auto shrink-0 text-xs">{fmt(l.at)}</span>
                      </div>
                      <span className="whitespace-nowrap max-md:hidden">{fmt(l.at)}</span>
                    </td>
                    <td data-label="Level" className="max-md:!hidden"><Badge v={l.level} /></td>
                    <td data-label="Scope" className="whitespace-nowrap font-mono text-xs text-slate-600 max-md:!hidden">{l.scope}</td>
                    <td className="w-full">
                      <div className="min-w-0 flex-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{l.message}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {smtp ? <NextStep text="Jawab 250 se shuru ho to mail server ne mail le li. 4xx ya 5xx dikhe to Settings mein SMTP test chala ke mailbox check karo." href="/settings" cta="Settings kholo" />
        // no error rows is not an all-clear: retryable send failures, blocked sends and dry-run failures are logged as warnings
        : errorsOnly && n === 0 ? <NextStep text="Warnings (jaise retry hone wali fail mails) 'App log' tab mein dikhti hain. Unhe bhi ek baar dekh lo." href="/logs" cta="App log dekho" />
        : <NextStep text="Koi error samajh na aaye to Settings mein Test buttons se SMTP / IMAP / AI check karo." href="/settings" cta="Settings kholo" />}
    </div>
  );
}
