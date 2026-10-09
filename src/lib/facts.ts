import * as cheerio from "cheerio";
import robotsParser from "robots-parser";

export type Facts = {
  hasWebsite: boolean;
  url?: string; finalUrl?: string;
  title?: string; description?: string;
  https?: boolean; mobileViewport?: boolean; loadMs?: number;
  menuLink?: boolean; bookingLink?: boolean; orderLink?: boolean;
  footerYear?: number;
  error?: string; blockedByRobots?: boolean;
};

export const USER_AGENT = "Mozilla/5.0 (compatible; SmallBizSiteCheck/1.0; one-time homepage check before a personal email)";

async function timedFetch(url: string, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" } });
  } finally { clearTimeout(t); }
}

export async function fetchFacts(website?: string | null): Promise<Facts> {
  if (!website || !website.trim()) return { hasWebsite: false };
  const url = /^https?:\/\//i.test(website.trim()) ? website.trim() : "https://" + website.trim();
  const facts: Facts = { hasWebsite: true, url };
  try {
    const origin = new URL(url).origin;
    try {
      const r = await timedFetch(origin + "/robots.txt", 5000);
      if (r.ok) {
        const robots = robotsParser(origin + "/robots.txt", await r.text());
        if (robots.isAllowed(url, USER_AGENT) === false) return { ...facts, blockedByRobots: true };
      }
    } catch { /* no robots.txt: allowed */ }

    const start = Date.now();
    let res: Response;
    try { res = await timedFetch(url, 10000); }
    catch { res = await timedFetch(url.replace(/^https:/, "http:"), 10000); }
    const html = (await res.text()).slice(0, 1_500_000);
    facts.loadMs = Date.now() - start;
    facts.finalUrl = res.url || url;
    facts.https = facts.finalUrl.startsWith("https://");
    if (!res.ok) { facts.error = `HTTP ${res.status}`; return facts; }

    const $ = cheerio.load(html);
    facts.title = $("title").first().text().trim().slice(0, 200) || undefined;
    facts.description = ($('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "").trim().slice(0, 300) || undefined;
    facts.mobileViewport = /width\s*=\s*device-width/i.test($('meta[name="viewport"]').attr("content") || "");
    const links = $("a").map((_, a) => `${$(a).text()} ${$(a).attr("href") || ""}`.toLowerCase()).get();
    const has = (re: RegExp) => links.some((l) => re.test(l));
    facts.menuLink = has(/\b(menu|carte|speisekarte|men[uú])\b/);
    facts.bookingLink = has(/(book|booking|réserv|reserv|rendez-vous|rdv|appointment|termin|calendly|planity|treatwell|thefork|lafourchette|doctolib)/);
    facts.orderLink = has(/(order|commander|commande|click.?collect|uber ?eats|deliveroo|just ?eat|shop|boutique)/);
    const footer = $("footer").text() || $("body").text().slice(-3000);
    const years = [...footer.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)].map((m) => +m[1]);
    const fallback = [...footer.matchAll(/\b(20[0-3]\d)\b/g)].map((m) => +m[1]);
    const ys = years.length ? years : fallback;
    if (ys.length) facts.footerYear = Math.max(...ys);
  } catch (e) {
    facts.error = e instanceof Error ? (e.name === "AbortError" ? "timeout (10 s)" : e.message) : "fetch failed";
  }
  return facts;
}

/** Human-readable fact list for the AI prompt (only true, stored facts) */
export function factsForPrompt(f: Facts) {
  if (!f.hasWebsite) return "- The business has NO website listed.";
  if (f.blockedByRobots) return "- They have a website, but it was not checked (robots.txt). Do not comment on the site's content.";
  if (f.error && !f.title) return `- They have a website (${f.url}) but it could not be loaded during the check (${f.error}).`;
  const L: string[] = [`- Website: ${f.finalUrl || f.url}`];
  if (f.title) L.push(`- Homepage title: "${f.title}"`);
  if (f.description) L.push(`- Meta description: "${f.description}"`);
  else L.push("- No meta description on the homepage");
  L.push(f.https ? "- Uses HTTPS" : "- Does NOT use HTTPS (not secure)");
  L.push(f.mobileViewport ? "- Has a mobile viewport tag" : "- No mobile viewport tag (likely not mobile-friendly)");
  if (f.loadMs) L.push(`- Homepage HTML loaded in ${(f.loadMs / 1000).toFixed(1)} s during the check`);
  L.push(f.menuLink ? "- Has a menu link" : "- No menu link found");
  L.push(f.bookingLink ? "- Has a booking/reservation link" : "- No online booking/reservation link found");
  L.push(f.orderLink ? "- Has an online order/shop link" : "- No online ordering link found");
  if (f.footerYear) L.push(`- Footer year: ${f.footerYear}`);
  return L.join("\n");
}
