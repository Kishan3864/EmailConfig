import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { COOKIE, verifyToken } from "@/lib/session";
import { C, count } from "@/lib/fsdb";
import { getSettings, getState } from "@/lib/settings";
import { AppShell, type ShellBanner } from "@/components/AppShell";
import { ToastProvider, ToastOnMount } from "@/components/toast";

export const metadata: Metadata = {
  title: { default: "Outreach", template: "%s · Outreach" },
  applicationName: "Outreach",
  appleWebApp: { capable: true, title: "Outreach", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover", themeColor: "#f5f6f8" };
export const dynamic = "force-dynamic";

/** banner: also shown as the red bar on every page; reload: the fix needs a full page load */
type Problem = { kind: "error" | "warning"; title: string; text?: string; href: string; cta: string; banner?: boolean; reload?: boolean };

/** What every page's frame needs: approval count, mode, and problems to show as toasts / a red banner. */
async function shellData(): Promise<{ waiting: number; dryRun: boolean | null; problems: Problem[] }> {
  try {
    const [s, st, waiting] = await Promise.all([getSettings(), getState(), count(C.messages.where("approved", "==", false).where("status", "==", "ready"))]);
    const problems: Problem[] = [];
    // an auto-pause sets both alert and globalStop: report it once
    if (st.alert) problems.push({ kind: "error", title: "Sending apne aap ruk gayi (auto-pause)", text: st.alert.message, href: "/", cta: "Dashboard kholo", banner: true });
    else if (st.globalStop) problems.push({ kind: "warning", title: "STOP on hai: koi mail nahi jayegi", text: "Taiyaar ho to Dashboard se stop hatao.", href: "/", cta: "Dashboard kholo", banner: true });
    const workerAlive = !!st.lastWorkerTick && Date.now() - new Date(st.lastWorkerTick).getTime() < 6 * 60000;
    if (!workerAlive) problems.push({ kind: "warning", title: "Worker nahi chal raha", text: "6 minute se worker ka koi signal nahi aaya, isliye mails nahi jayengi. Server pe check karo: pm2 status", href: "/logs", cta: "Logs dekho" });
    if (st.dns && (!st.dns.spf || !st.dns.dkim)) problems.push({ kind: "warning", title: "SPF ya DKIM missing hai", text: "DNS theek kiye bina campaign start nahi hoga.", href: "/settings", cta: "Settings kholo" });
    return { waiting, dryRun: s.dryRun, problems };
  } catch (e) {
    const problems: Problem[] = [{ kind: "error", title: "Database se connect nahi ho paya", text: e instanceof Error ? e.message : String(e), href: "/", cta: "Dobara load karo", banner: true, reload: true }];
    return { waiting: 0, dryRun: null, problems };
  }
}

export default async function Root({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const authed = await verifyToken(jar.get(COOKIE)?.value);
  if (!authed) {
    return (
      <html lang="en">
        <body><ToastProvider>{children}</ToastProvider></body>
      </html>
    );
  }
  const { waiting, dryRun, problems } = await shellData();
  const top = problems.find((p) => p.banner);
  const banner: ShellBanner = top ? { title: top.title, text: top.text, href: top.href, hard: top.reload } : null;
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <AppShell collapsed={jar.get("sb")?.value === "1"} waiting={waiting} dryRun={dryRun} banner={banner}>{children}</AppShell>
          {problems.map((p) => <ToastOnMount key={p.title} kind={p.kind} title={p.title} text={p.text} href={p.href} cta={p.cta} reload={p.reload} once={`problem:${p.title}:${p.text || ""}`} />)}
        </ToastProvider>
      </body>
    </html>
  );
}
