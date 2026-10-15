"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { Info } from "./Info";
import { Logo } from "./ui";
import { ALL_NAV, MOBILE_TABS, NAV, findNav, isActive, type NavItem } from "./nav";

/** hard: use a full page load (the shell itself is stale, e.g. after a database error) */
export type ShellBanner = { title: string; text?: string; href: string; hard?: boolean } | null;

const REFRESH_GAP = 60_000; // at most one background refresh per minute
const REFRESH_EVERY = 5 * 60_000;

/**
 * App frame. Desktop: sidebar (expand/collapse, remembered in the "sb" cookie) + top bar.
 * Phone: app bar on top, tab bar at the bottom and an "Aur" sheet with every menu, like a native app.
 * dryRun is null when the mode could not be read.
 */
export function AppShell({ children, collapsed: initial, waiting, dryRun, banner }: { children: ReactNode; collapsed: boolean; waiting: number; dryRun: boolean | null; banner: ShellBanner }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(initial);
  const [sheet, setSheet] = useState(false);

  useEffect(() => setSheet(false), [pathname]);
  useEffect(() => {
    if (!sheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [sheet]);

  // the shell (approval badge, mode, red banner) is only rendered on a full load; keep it fresh while the app stays open
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < REFRESH_GAP) return;
      last = Date.now();
      router.refresh();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const t = setInterval(refresh, REFRESH_EVERY);
    return () => { document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); clearInterval(t); };
  }, [router]);

  const toggle = () => {
    const c = !collapsed;
    setCollapsed(c);
    document.cookie = `sb=${c ? 1 : 0}; path=/; max-age=31536000; samesite=lax`;
  };

  const current = findNav(pathname);
  const detail = !!current && pathname !== current.href;
  const count = (href: string) => (href === "/review" ? waiting : 0);
  const mode = dryRun === null
    ? { short: "MODE ?", title: "Mode pata nahi", sub: "Database se mode nahi padh paye", icon: "alert" as const, box: "border-slate-200 bg-slate-50 hover:bg-slate-100", chip: "bg-slate-200 text-slate-600", text: "text-slate-700", pill: "bg-slate-100 text-slate-600 ring-slate-500/20", dot: "bg-slate-400" }
    : dryRun
      ? { short: "DRY-RUN", title: "DRY-RUN mode", sub: "Mails sirf aapke test address pe", icon: "flask" as const, box: "border-amber-200 bg-amber-50/70 hover:bg-amber-50", chip: "bg-amber-100 text-amber-700", text: "text-amber-800", pill: "bg-amber-50 text-amber-700 ring-amber-600/20", dot: "bg-amber-500" }
      : { short: "LIVE", title: "LIVE mode", sub: "Mails asli leads ko jaa rahi hain", icon: "zap" as const, box: "border-emerald-200 bg-emerald-50/70 hover:bg-emerald-50", chip: "bg-emerald-100 text-emerald-700", text: "text-emerald-800", pill: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", dot: "animate-pulse bg-emerald-500" };

  return (
    <div id="top" className="min-h-dvh">
      {/* ---------- desktop sidebar ---------- */}
      <aside className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-slate-200/80 bg-white transition-[width] duration-200 ease-out lg:flex ${collapsed ? "w-[68px]" : "w-60"}`}>
        <Link href="/" className={`flex h-14 shrink-0 items-center gap-2.5 border-b border-slate-100 ${collapsed ? "justify-center" : "px-4"}`}>
          <Logo size={30} />
          {!collapsed && (
            <span className="min-w-0 leading-tight">
              <span className="block text-[14px] font-semibold tracking-tight text-slate-900">Outreach</span>
              <span className="block text-2xs text-slate-400">Dheere aur safe cold mail</span>
            </span>
          )}
        </Link>

        <nav className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3 [scrollbar-width:thin] [@media(max-height:720px)]:space-y-2" aria-label="Menu">
          {NAV.map((g, gi) => (
            <div key={g.title}>
              {/* short screens (e.g. 1366x768 laptops) drop the group titles so every menu fits */}
              {collapsed
                ? gi > 0 && <div className="mx-auto mb-2 h-px w-6 bg-slate-200" />
                : <>
                    <div className="mb-1 px-2.5 text-2xs font-bold uppercase tracking-wider text-slate-400 [@media(max-height:720px)]:hidden">{g.title}</div>
                    {gi > 0 && <div className="mx-2.5 mb-2 hidden h-px bg-slate-100 [@media(max-height:720px)]:block" />}
                  </>}
              <div className="space-y-0.5">
                {g.items.map((it) => <SideLink key={it.href} it={it} on={current?.href === it.href} collapsed={collapsed} count={count(it.href)} />)}
              </div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 space-y-1 border-t border-slate-100 p-3 [@media(max-height:720px)]:py-2">
          <Link href="/#mode" title={collapsed ? mode.title : undefined}
            className={`flex items-center gap-2.5 rounded-lg border transition ${collapsed ? "justify-center p-1.5" : "px-2.5 py-2 [@media(max-height:720px)]:py-1.5"} ${mode.box}`}>
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${mode.chip}`}><Icon name={mode.icon} size={14} /></span>
            {!collapsed && (
              <span className="min-w-0 leading-tight">
                <span className={`block text-xs font-semibold ${mode.text}`}>{mode.title}</span>
                <span className="block truncate text-2xs text-slate-500 [@media(max-height:720px)]:hidden">{mode.sub}</span>
              </span>
            )}
          </Link>
          <form action="/api/logout" method="post">
            <button title={collapsed ? "Logout" : undefined} className={`flex h-8 w-full items-center gap-2.5 rounded-lg text-sm font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600 ${collapsed ? "justify-center" : "px-2.5"}`}>
              <Icon name="logout" size={17} />{!collapsed && "Logout"}
            </button>
          </form>
        </div>
      </aside>

      <div className={`transition-[padding] duration-200 ease-out ${collapsed ? "lg:pl-[68px]" : "lg:pl-60"}`}>
        {/* ---------- top bar ---------- */}
        <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 pt-safe backdrop-blur-md lg:bg-canvas/80">
          <div className="flex h-12 items-center gap-2 px-3 sm:px-4 lg:h-14 lg:px-6">
            {/* phone: back button on detail pages, brand on top-level pages */}
            <div className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
              {detail && current ? (
                <Link href={current.href} className="-ml-1.5 inline-flex items-center rounded-lg py-1 pr-2 text-[14px] font-medium text-indigo-600 active:bg-slate-100">
                  <Icon name="chevron-left" size={22} strokeWidth={2.2} />{current.short}
                </Link>
              ) : (
                <Link href="/" className="flex min-w-0 items-center gap-2">
                  <Logo size={28} />
                  <span className="truncate text-[15px] font-semibold tracking-tight text-slate-900">Outreach</span>
                </Link>
              )}
            </div>

            {/* desktop: sidebar toggle + breadcrumb */}
            <div className="hidden min-w-0 flex-1 items-center gap-2 lg:flex">
              <button type="button" onClick={toggle} className="btn-ghost btn-icon -ml-2" aria-label={collapsed ? "Sidebar kholo" : "Sidebar chhota karo"} title={collapsed ? "Sidebar kholo" : "Sidebar chhota karo"}>
                <Icon name={collapsed ? "panel-open" : "panel-close"} size={17} />
              </button>
              <span className="h-5 w-px bg-slate-200" />
              <div className="flex min-w-0 items-center gap-1.5 text-sm">
                {current && <Icon name={current.icon} size={15} className="text-slate-400" />}
                {detail && current ? (
                  <>
                    <Link href={current.href} className="font-medium text-slate-500 hover:text-slate-900">{current.label}</Link>
                    <Icon name="chevron-right" size={13} className="text-slate-300" />
                    <span className="truncate font-medium text-slate-900">Detail</span>
                  </>
                ) : <span className="truncate font-medium text-slate-900">{current?.label || "Outreach"}</span>}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {waiting > 0 && !pathname.startsWith("/review") && (
                <Link href="/review" className="btn btn-sm hidden lg:inline-flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{waiting === 1 ? "1 mail approve karni hai" : `${waiting} mails approve karni hain`}
                </Link>
              )}
              <Link href="/#mode" className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-2xs font-bold ring-1 ring-inset ${collapsed ? "" : "lg:hidden"} ${mode.pill}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${mode.dot}`} />{mode.short}
              </Link>
            </div>
          </div>

          {banner && pathname !== "/" && (() => {
            const inner = (
              <>
                <Icon name="alert" size={14} />
                <span className="min-w-0 flex-1 truncate"><b>{banner.title}</b>{banner.text ? ` · ${banner.text}` : ""}</span>
                <span className="hidden shrink-0 items-center gap-1 sm:inline-flex">{banner.hard ? "Dobara load karo" : "Dashboard pe dekho"} <Icon name="arrow-right" size={12} /></span>
              </>
            );
            const cls = "flex items-center gap-2 bg-red-600 px-4 py-2 text-xs font-medium text-white lg:px-6";
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            return banner.hard ? <a href={banner.href} className={cls}>{inner}</a> : <Link href={banner.href} className={cls}>{inner}</Link>;
          })()}
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 pb-[calc(env(safe-area-inset-bottom)+88px)] pt-4 sm:px-6 lg:px-8 lg:pb-12 lg:pt-6">{children}</main>
      </div>

      {/* ---------- phone tab bar ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/90 pb-safe backdrop-blur-md lg:hidden" aria-label="Main menu">
        <div className="mx-auto grid h-[58px] max-w-lg grid-cols-5">
          {MOBILE_TABS.map((href) => {
            const it = ALL_NAV.find((x) => x.href === href)!;
            return <TabLink key={href} href={href} icon={<Icon name={it.icon} size={20} strokeWidth={isActive(href, pathname) ? 2.1 : 1.8} />} label={it.short} on={isActive(href, pathname)} count={count(href)} />;
          })}
          <button type="button" onClick={() => setSheet(true)} className={`flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition active:scale-95 ${!MOBILE_TABS.some((h) => isActive(h, pathname)) ? "text-indigo-600" : "text-slate-500"}`}>
            <span className={`grid h-7 w-12 place-items-center rounded-full ${!MOBILE_TABS.some((h) => isActive(h, pathname)) ? "bg-indigo-50" : ""}`}><Icon name="grid" size={20} /></span>
            Aur
          </button>
        </div>
      </nav>

      {/* ---------- phone "Aur" sheet with every menu ---------- */}
      {sheet && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Saare menu">
          <button type="button" aria-label="Band karo" onClick={() => setSheet(false)} className="absolute inset-0 animate-fade-in bg-slate-900/40" />
          <div className="absolute inset-x-0 bottom-0 max-h-[88dvh] animate-sheet-in overflow-y-auto rounded-t-2xl bg-canvas pb-safe shadow-pop">
            <div className="sticky top-0 z-10 bg-canvas/95 px-4 pb-2 pt-2.5 backdrop-blur">
              <div className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-slate-300" />
              <div className="flex items-center justify-between">
                <div className="text-[15px] font-semibold text-slate-900">Saare menu</div>
                <button type="button" onClick={() => setSheet(false)} className="btn-ghost btn-icon btn-sm" aria-label="Band karo"><Icon name="x" size={16} /></button>
              </div>
            </div>
            <div className="space-y-4 px-3 pb-5">
              {NAV.map((g) => (
                <div key={g.title}>
                  <div className="px-2 pb-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400">{g.title}</div>
                  <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 bg-white">
                    {g.items.map((it) => {
                      const on = current?.href === it.href;
                      const n = count(it.href);
                      return (
                        <Link key={it.href} href={it.href} onClick={() => setSheet(false)} className={`flex items-start gap-3 px-3 py-2.5 transition active:bg-slate-50 ${on ? "bg-indigo-50/60" : ""}`}>
                          <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}><Icon name={it.icon} size={16} /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-slate-900">
                              {it.label}
                              {n > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-2xs font-bold leading-4 text-white">{n}</span>}
                            </span>
                            <span className="mt-0.5 block text-xs leading-snug text-slate-500">{it.info}</span>
                          </span>
                          <Icon name="chevron-right" size={16} className="mt-2 text-slate-300" />
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
              <form action="/api/logout" method="post">
                <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-3 text-[13.5px] font-medium text-red-600 active:bg-red-50">
                  <Icon name="logout" size={16} />Logout
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SideLink({ it, on, collapsed, count }: { it: NavItem; on: boolean; collapsed: boolean; count: number }) {
  return (
    <Link href={it.href} title={collapsed ? it.label : undefined} aria-current={on ? "page" : undefined}
      className={`group relative flex h-8 items-center gap-2.5 rounded-lg text-sm font-medium transition ${collapsed ? "justify-center" : "px-2.5"} ${on ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
      {on && <span className="absolute -left-3 bottom-1.5 top-1.5 w-[3px] rounded-r-full bg-indigo-600" />}
      <Icon name={it.icon} size={17} className={on ? "text-indigo-600" : "text-slate-400 transition group-hover:text-slate-600"} />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{it.label}</span>}
      {count > 0 && (collapsed
        ? <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" />
        : <span className="rounded-full bg-amber-500 px-1.5 text-2xs font-bold leading-4 text-white">{count > 99 ? "99+" : count}</span>)}
      {/* the (i) shows on mouse hover only; touch screens and keyboards get the plain link (the phone menu shows the text) */}
      {!collapsed && !count && (
        <span className="hidden opacity-0 transition group-hover:opacity-100 [@media(hover:hover)]:inline-flex">
          <Info text={it.info} title={it.label} size={13} focusable={false} />
        </span>
      )}
    </Link>
  );
}

function TabLink({ href, icon, label, on, count }: { href: string; icon: ReactNode; label: string; on: boolean; count: number }) {
  return (
    <Link href={href} aria-current={on ? "page" : undefined} className={`flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition active:scale-95 ${on ? "text-indigo-600" : "text-slate-500"}`}>
      <span className={`relative grid h-7 w-12 place-items-center rounded-full transition ${on ? "bg-indigo-50" : ""}`}>
        {icon}
        {count > 0 && <span className="absolute -top-1 right-1 min-w-[16px] rounded-full bg-amber-500 px-1 text-center text-[9.5px] font-bold leading-4 text-white ring-2 ring-white">{count > 99 ? "99+" : count}</span>}
      </span>
      {label}
    </Link>
  );
}
