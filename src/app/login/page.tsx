import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, verifyToken } from "@/lib/session";
import { Icon } from "@/components/icons";
import { Callout, Logo } from "@/components/ui";
import { ToastOnMount } from "@/components/toast";

export const metadata = { title: "Login" };

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await verifyToken((await cookies()).get(COOKIE)?.value)) redirect("/");
  const { e } = await searchParams;
  const locked = e === "locked";
  const err = e ? (locked ? "Bahut baar galat password daala gaya. 15 minute baad dobara try karo." : "Password galat hai. Dobara try karo.") : "";
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_45%_at_50%_0%,rgba(99,102,241,0.16),transparent_70%)]" />
      <div className="relative w-full max-w-[360px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size={46} />
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">Outreach mein login karo</h1>
          <p className="mt-1 text-sm text-slate-500">Dheere aur safe cold mail, sirf aapke liye.</p>
        </div>
        <form action="/api/login" method="post" className="card space-y-4 sm:p-6">
          <label className="block">
            <span className="label">Password</span>
            <span className="relative block">
              <Icon name="lock" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input name="password" type="password" autoComplete="current-password" placeholder="Apna app password" className="input h-10 pl-9" autoFocus required />
            </span>
          </label>
          {err && <Callout tone="danger">{err}</Callout>}
          <button className="btn-primary h-10 w-full">Login karo <Icon name="arrow-right" size={15} /></button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-400">Password bhool gaye? Server admin se poocho.</p>
        {err && <ToastOnMount kind="error" title={locked ? "Login abhi band hai" : "Login nahi hua"} text={err} />}
      </div>
    </div>
  );
}
