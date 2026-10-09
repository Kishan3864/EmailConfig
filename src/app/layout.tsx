import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { COOKIE, verifyToken } from "@/lib/session";

export const metadata = { title: "Outreach" };
export const dynamic = "force-dynamic";

const NAV = [["/", "Dashboard"], ["/import", "Import"], ["/campaigns", "Campaigns"], ["/contacts", "Contacts"], ["/replies", "Replies"], ["/suppression", "Suppression"], ["/logs", "Logs"], ["/settings", "Settings"]];

export default async function Root({ children }: { children: ReactNode }) {
  const authed = await verifyToken((await cookies()).get(COOKIE)?.value);
  return (
    <html lang="en">
      <body>
        {authed && (
          <header className="bg-white border-b border-slate-200">
            <div className="max-w-7xl mx-auto px-4 flex items-center gap-1 h-14 overflow-x-auto">
              <span className="font-semibold mr-4">✉ Outreach</span>
              {NAV.map(([href, label]) => <Link key={href} href={href} className="px-3 py-1.5 rounded-md text-sm hover:bg-slate-100 whitespace-nowrap">{label}</Link>)}
              <form action="/api/logout" method="post" className="ml-auto"><button className="text-sm text-slate-500 hover:text-slate-800">Log out</button></form>
            </div>
          </header>
        )}
        <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
