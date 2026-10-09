export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <form action="/api/login" method="post" className="card w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Outreach</h1>
        <input name="password" type="password" placeholder="Password" className="input" autoFocus required />
        {e && <p className="text-sm text-red-600">{e === "locked" ? "Too many attempts, wait 15 minutes." : "Wrong password."}</p>}
        <button className="btn-primary w-full">Log in</button>
      </form>
    </div>
  );
}
