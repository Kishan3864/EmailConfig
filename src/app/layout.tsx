import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { COOKIE, verifyToken } from "@/lib/session";
import { C, count } from "@/lib/fsdb";
import { getSettings, getState } from "@/lib/settings";
import { LANG_COOKIE, htmlLang, makeT, toLang, type T } from "@/lib/i18n";
import { AppShell, type ShellBanner } from "@/components/AppShell";
import { LangProvider } from "@/components/lang";
import { ToastProvider, ToastOnMount } from "@/components/toast";

export const metadata: Metadata = {
  title: { default: "Outreach", template: "%s · Outreach" },
  applicationName: "Outreach",
  appleWebApp: { capable: true, title: "Outreach", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover", themeColor: "#f5f6f8" };
export const dynamic = "force-dynamic";

/** id: same in both languages (a toast shows once per session); banner: also the red bar on every page; reload: the fix needs a full page load */
type Problem = { id: string; kind: "error" | "warning"; title: string; text?: string; href: string; cta: string; banner?: boolean; reload?: boolean };

/** What every page's frame needs: approval count, mode, and problems to show as toasts / a red banner. */
async function shellData(t: T): Promise<{ waiting: number; dryRun: boolean | null; problems: Problem[] }> {
  try {
    const [s, st, waiting] = await Promise.all([getSettings(), getState(), count(C.messages.where("approved", "==", false).where("status", "==", "ready"))]);
    const problems: Problem[] = [];
    const openDashboard = t("Dashboard kholo", "Open dashboard");
    // an auto-pause sets both alert and globalStop: report it once
    if (st.alert) problems.push({ id: "alert:" + st.alert.message, kind: "error", title: t("Sending apne aap ruk gayi (auto-pause)", "Sending was paused automatically"), text: st.alert.message, href: "/", cta: openDashboard, banner: true });
    else if (st.globalStop) problems.push({ id: "stop", kind: "warning", title: t("STOP on hai: koi mail nahi jayegi", "STOP is on: no mail will go out"), text: t("Taiyaar ho to Dashboard se stop hatao.", "When you are ready, clear the stop on the Dashboard."), href: "/", cta: openDashboard, banner: true });
    const workerAlive = !!st.lastWorkerTick && Date.now() - new Date(st.lastWorkerTick).getTime() < 6 * 60000;
    if (!workerAlive) problems.push({ id: "worker", kind: "warning", title: t("Worker nahi chal raha", "The worker is not running"), text: t("6 minute se worker ka koi signal nahi aaya, isliye mails nahi jayengi. Server pe check karo: pm2 status", "No signal from the worker for 6 minutes, so no mail will go out. Check on the server: pm2 status"), href: "/logs", cta: t("Logs dekho", "See logs") });
    if (st.dns && (!st.dns.spf || !st.dns.dkim)) problems.push({ id: "dns", kind: "warning", title: t("SPF ya DKIM missing hai", "SPF or DKIM is missing"), text: t("DNS theek kiye bina campaign start nahi hoga.", "A campaign cannot start until DNS is fixed."), href: "/settings", cta: t("Settings kholo", "Open settings") });
    return { waiting, dryRun: s.dryRun, problems };
  } catch (e) {
    const problems: Problem[] = [{ id: "db", kind: "error", title: t("Database se connect nahi ho paya", "Could not connect to the database"), text: e instanceof Error ? e.message : String(e), href: "/", cta: t("Dobara load karo", "Reload"), banner: true, reload: true }];
    return { waiting: 0, dryRun: null, problems };
  }
}

export default async function Root({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const lang = toLang(jar.get(LANG_COOKIE)?.value);
  const authed = await verifyToken(jar.get(COOKIE)?.value);
  if (!authed) {
    return (
      <html lang={htmlLang(lang)}>
        <body><LangProvider lang={lang}><ToastProvider>{children}</ToastProvider></LangProvider></body>
      </html>
    );
  }
  const { waiting, dryRun, problems } = await shellData(makeT(lang));
  const top = problems.find((p) => p.banner);
  const banner: ShellBanner = top ? { title: top.title, text: top.text, href: top.href, hard: top.reload } : null;
  return (
    <html lang={htmlLang(lang)}>
      <body>
        <LangProvider lang={lang}>
          <ToastProvider>
            <AppShell collapsed={jar.get("sb")?.value === "1"} waiting={waiting} dryRun={dryRun} banner={banner}>{children}</AppShell>
            {problems.map((p) => <ToastOnMount key={p.id} kind={p.kind} title={p.title} text={p.text} href={p.href} cta={p.cta} reload={p.reload} once={`problem:${p.id}`} />)}
          </ToastProvider>
        </LangProvider>
      </body>
    </html>
  );
}
