import Link from "next/link";
import { C, rows, type SendLog, type LogRow } from "@/lib/fsdb";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { Badge, Callout, EmptyState, NextStep, PageHeader, Section } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { fmt } from "@/lib/time";

export const metadata = { title: "Logs" }; // the same in both languages

const views = (t: T): Record<"logs" | "errors" | "smtp", { title: string; icon: IconName; info: string }> => ({
  logs: {
    title: "App log",
    icon: "activity",
    info: t(
      "App aur worker ne jo bhi kiya uska record: settings save, import, campaign, mail bhejna, inbox sync waghera. Level batata hai kitna zaroori hai: Info = normal, Warning = dhyan do, Error = kuch fail hua. Scope batata hai ki entry app ke kis hisse se aayi.",
      "A record of everything the app and the worker did: saving settings, imports, campaigns, sending mail, inbox sync and so on. Level shows how important it is: Info = normal, Warning = pay attention, Error = something failed. Scope shows which part of the app the entry came from.",
    ),
  },
  errors: {
    title: t("Sirf errors", "Errors only"),
    icon: "x-circle",
    info: t(
      "Sirf Error level wali entries, jahan kuch fail hua. Message padho: zyada tar mein wajah likhi hoti hai (jaise SMTP login fail ya AI key galat). Theek karne ke baad Settings mein Test button se check karo. Warnings (jaise retry hone wali fail mails) yahan nahi, 'App log' tab mein dikhti hain.",
      "Only Error level entries, where something failed. Read the message: most of them name the cause (like a failed SMTP login or a wrong AI key). After fixing it, check with the test buttons in Settings. Warnings (like failed mails that will be retried) are not shown here but in the 'App log' tab.",
    ),
  },
  smtp: {
    title: t("SMTP jawab", "SMTP responses"),
    icon: "server",
    info: t(
      "Har mail bhejne pe mail server ne jo jawab diya, wo yahan hai. 250 se shuru hone wala jawab matlab server ne mail le li. 4xx matlab abhi nahi (baad mein retry hota hai), 5xx matlab server ne mana kar diya. Mode batata hai ki mail Dry-run thi (sirf test address pe) ya Live.",
      "The mail server's response to every mail sent is here. A response starting with 250 means the server accepted the mail. 4xx means not right now (it is retried later), 5xx means the server refused it. Mode shows whether the mail was a Dry-run (only to the test address) or Live.",
    ),
  },
});
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function Logs({ searchParams }: { searchParams: Promise<{ tab?: string; level?: string }> }) {
  const { t } = await getT();
  const { tab = "logs", level } = await searchParams;
  const sends = tab === "smtp" ? rows<SendLog>(await C.sendLogs.orderBy("at", "desc").limit(500).get()) : [];
  const logs = tab === "smtp" ? [] : rows<LogRow>(await (level ? C.logs.where("level", "==", level) : C.logs).orderBy("at", "desc").limit(500).get());

  const VIEW = views(t);
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
  const sub = n === 0 ? t("Koi record nahi", "No records")
    : smtp ? t(`${n} jawab · ${fails} fail`, `${plural(n, "response")} · ${fails} failed`)
    : errorsOnly || level ? t(`${n} record${n >= 500 ? " (sirf sabse naye)" : ""}`, `${plural(n, "record")}${n >= 500 ? " (newest only)" : ""}`)
    : t(
      `${n} record · ${warns} warning · ${errs} error${n >= 500 ? " (sabse naye 500 mein)" : ""}`,
      `${plural(n, "record")} · ${plural(warns, "warning")} · ${plural(errs, "error")}${n >= 500 ? " (in the newest 500)" : ""}`,
    );
  const time = t("Samay", "Time");
  const to = t("Kisko", "To");
  const response = t("Server ka jawab", "Server response");
  const openSettings = t("Settings kholo", "Open settings");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Logs"
        info={t(
          "Yahan app aur worker ka poora record hai: kya hua, kab hua, aur koi problem aayi to kya. 'Sirf errors' tab mein sirf Error level wali entries dikhti hain. 'SMTP jawab' tab mein har bheji mail pe mail server ka asli jawab milta hai.",
          "The full record of the app and the worker: what happened, when, and what went wrong if there was a problem. The 'Errors only' tab shows only Error level entries. The 'SMTP responses' tab shows the mail server's actual response to every mail sent.",
        )}
        sub={t("App, worker aur mail server ka record · naya sabse upar", "Record of the app, worker and mail server · newest first")}
        actions={
          <nav className="seg" aria-label={t("Log ke tab", "Log tabs")}>
            {tabs.map((tb) => (
              <Link key={tb.href} href={tb.href} aria-current={tb.on ? "page" : undefined} className={`seg-item ${tb.on ? "seg-item-on" : ""}`}>
                <Icon name={tb.icon} size={13} />{tb.title}
              </Link>
            ))}
          </nav>
        }
      />

      {lastErr && (
        <Callout tone="warn" title={t(`Is list mein ${errs} error ${errs === 1 ? "hai" : "hain"}`, `This list has ${plural(errs, "error")}`)}
          action={<Link href="/logs?level=error" className="btn btn-sm"><Icon name="x-circle" size={14} />{t("Sirf errors dekho", "Show errors only")}</Link>}>
          {t(
            <>Sabse naya error {fmt(lastErr.at)} ko aaya ({lastErr.scope}). Samajh na aaye to Settings mein Test buttons se check karo.</>,
            <>The latest error was on {fmt(lastErr.at)} ({lastErr.scope}). If it is unclear, check with the test buttons in Settings.</>,
          )}
        </Callout>
      )}
      {smtp && fails > 0 && (
        <Callout tone="warn" title={t(`${fails} mail server ne nahi li`, `The server did not accept ${plural(fails, "mail")}`)}>
          {t(
            "Neeche 'Fail' wali line ka server jawab padho. 4xx matlab baad mein retry hoga, 5xx matlab server ne mana kar diya.",
            "Read the server response on the 'Failed' rows below. 4xx means it will be retried later, 5xx means the server refused it.",
          )}
        </Callout>
      )}

      <Section flush title={view.title} icon={view.icon} info={view.info} sub={sub}>
        {n === 0 ? (
          smtp ? <EmptyState icon="server" title={t("Abhi koi SMTP jawab nahi hai", "No SMTP responses yet")} text={t("Jab koi mail jayegi, mail server ka jawab yahan dikhega.", "When a mail goes out, the mail server's response shows up here.")} href="/review" cta={t("Mails approve karo", "Approve mails")} />
          : errorsOnly ? <EmptyState icon="check-circle" title={t("Koi error nahi hai", "No errors")} text={t("Abhi tak koi error record nahi hua.", "No error has been recorded so far.")} />
          : <EmptyState icon="activity" title={t("Abhi koi log nahi hai", "No logs yet")} text={t("Jaise hi app kuch karega (settings save, import, mail bhejna), uska record yahan dikhega.", "As soon as the app does something (saving settings, an import, sending mail), it is recorded here.")} href="/settings" cta={t("Settings se shuru karo", "Start with Settings")} />
        ) : smtp ? (
          <div className="overflow-x-auto">
            <table className="tbl tbl-stack">
              <thead><tr><th>{time}</th><th>{to}</th><th>Result</th><th>Mode</th><th>{response}</th></tr></thead>
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
                    <td data-label={to} className="break-all font-medium text-slate-900 max-md:!hidden">{s.to}</td>
                    <td data-label="Result"><Badge v={s.ok ? "sent" : "failed"} /></td>
                    <td data-label="Mode"><Badge v={s.dryRun ? "dry-run" : "live"} /></td>
                    <td>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 text-xs font-medium text-slate-400 md:hidden">{response}</div>
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
              <thead><tr><th>{time}</th><th>Level</th><th>Scope</th><th>Message</th></tr></thead>
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

      {smtp ? <NextStep text={t("Jawab 250 se shuru ho to mail server ne mail le li. 4xx ya 5xx dikhe to Settings mein SMTP test chala ke mailbox check karo.", "A response starting with 250 means the mail server accepted the mail. If you see 4xx or 5xx, run the SMTP test in Settings to check the mailbox.")} href="/settings" cta={openSettings} />
        // no error rows is not an all-clear: retryable send failures, blocked sends and dry-run failures are logged as warnings
        : errorsOnly && n === 0 ? <NextStep text={t("Warnings (jaise retry hone wali fail mails) 'App log' tab mein dikhti hain. Unhe bhi ek baar dekh lo.", "Warnings (like failed mails that will be retried) are in the 'App log' tab. Take a look at them too.")} href="/logs" cta={t("App log dekho", "View app log")} />
        : <NextStep text={t("Koi error samajh na aaye to Settings mein Test buttons se SMTP / IMAP / AI check karo.", "If an error is unclear, check SMTP / IMAP / AI with the test buttons in Settings.")} href="/settings" cta={openSettings} />}
    </div>
  );
}
