import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { COOKIE, MAX_AGE, makeToken } from "@/lib/session";

const tries = new Map<string, { n: number; t: number }>();

// relative Location: behind a reverse proxy the server only knows itself as 127.0.0.1:<port>
const seeOther = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

export async function POST(req: Request) {
  // X-Real-IP is set by the proxy and cannot be forged by the client (X-Forwarded-For can be prepended to)
  const ip = req.headers.get("x-real-ip") || "local";
  const rec = tries.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - rec.t > 15 * 60000) { rec.n = 0; rec.t = Date.now(); }
  if (rec.n >= 10) return seeOther("/login?e=locked");
  const form = await req.formData();
  const pw = Buffer.from(String(form.get("password") || ""));
  const real = Buffer.from(process.env.APP_PASSWORD || "");
  const ok = real.length > 0 && pw.length === real.length && timingSafeEqual(pw, real);
  if (!ok) { rec.n++; tries.set(ip, rec); return seeOther("/login?e=1"); }
  const res = seeOther("/");
  res.cookies.set(COOKIE, await makeToken(), { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true", maxAge: MAX_AGE, path: "/" });
  return res;
}
