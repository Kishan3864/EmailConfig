import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verifyToken } from "@/lib/session";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/login")) return NextResponse.next();
  if (await verifyToken(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
