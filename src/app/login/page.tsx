import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, verifyToken } from "@/lib/session";
import { getT } from "@/lib/i18n-server";
import { Icon } from "@/components/icons";
import { LangSwitch } from "@/components/lang";
import { Callout, Logo } from "@/components/ui";
import { ToastOnMount } from "@/components/toast";

export const metadata = { title: "Login" };

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await verifyToken((await cookies()).get(COOKIE)?.value)) redirect("/");
  const { t } = await getT();
  const { e } = await searchParams;
  const locked = e === "locked";
  const err = e
    ? locked
      ? t("Bahut baar galat password daala gaya. 15 minute baad dobara try karo.", "Too many wrong attempts. Try again in 15 minutes.")
      : t("Password galat hai. Dobara try karo.", "Wrong password. Try again.")
    : "";
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_45%_at_50%_0%,rgba(99,102,241,0.16),transparent_70%)]" />
      <div className="absolute right-4 top-[calc(env(safe-area-inset-top)+16px)]"><LangSwitch /></div>
      <div className="relative w-full max-w-[360px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size={46} />
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">{t("Outreach mein login karo", "Log in to Outreach")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("Dheere aur safe cold mail, sirf aapke liye.", "Slow and safe cold email, just for you.")}</p>
        </div>
        <form action="/api/login" method="post" className="card space-y-4 sm:p-6">
          <label className="block">
            <span className="label">Password</span>
            <span className="relative block">
              <Icon name="lock" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input name="password" type="password" autoComplete="current-password" placeholder={t("Apna app password", "Your app password")} className="input h-10 pl-9" autoFocus required />
            </span>
          </label>
          {err && <Callout tone="danger">{err}</Callout>}
          <button className="btn-primary h-10 w-full">{t("Login karo", "Log in")} <Icon name="arrow-right" size={15} /></button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-400">{t("Password bhool gaye? Server admin se poocho.", "Forgot the password? Ask your server admin.")}</p>
        {err && <ToastOnMount kind="error" title={locked ? t("Login abhi band hai", "Login is locked for now") : t("Login nahi hua", "Login failed")} text={err} />}
      </div>
    </div>
  );
}
