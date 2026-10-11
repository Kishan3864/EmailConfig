import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/session";

export async function POST() {
  // relative Location: behind a reverse proxy the server only knows itself as 127.0.0.1:<port>
  const res = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  res.cookies.delete(COOKIE);
  return res;
}
