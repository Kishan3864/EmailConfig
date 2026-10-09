import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { COOKIE, MAX_AGE, makeToken } from "@/lib/session";

const tries = new Map<string, { n: number; t: number }>();

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "local";
  const rec = tries.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - rec.t > 15 * 60000) { rec.n = 0; rec.t = Date.now(); }
  if (rec.n >= 10) return NextResponse.redirect(new URL("/login?e=locked", req.url), 303);
  const form = await req.formData();
  const pw = Buffer.from(String(form.get("password") || ""));
  const real = Buffer.from(process.env.APP_PASSWORD || "");
  const ok = real.length > 0 && pw.length === real.length && timingSafeEqual(pw, real);
  if (!ok) { rec.n++; tries.set(ip, rec); return NextResponse.redirect(new URL("/login?e=1", req.url), 303); }
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(COOKIE, await makeToken(), { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true", maxAge: MAX_AGE, path: "/" });
  return res;
}
