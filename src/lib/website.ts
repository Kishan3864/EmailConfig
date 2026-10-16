/*
 * Does a lead have a website of its own? A "by website" campaign (lib/templates.ts) sends one template to leads
 * without one and another to leads with one. Only the CSV's website value counts: nothing is fetched.
 * A link to a social profile, a link-in-bio page, a map or directory listing, a chat link or a booking / delivery
 * platform is not their own website, so such a lead gets the "no website" template.
 * Pure code (no server imports): the campaign form and the Settings preview use it in the browser too.
 */

/** Hosts (and their subdomains) that are never a business's own website. */
const NOT_OWN_HOSTS = [
  "facebook.com", "fb.com", "fb.me", "instagram.com", "instagr.am", "tiktok.com", "twitter.com", "x.com", "threads.net",
  "youtube.com", "youtu.be", "linkedin.com", "pinterest.com", "snapchat.com",
  "linktr.ee", "linktree.com", "beacons.ai", "bio.link", "linkin.bio", "lnk.bio", "taplink.cc", "solo.to",
  "wa.me", "whatsapp.com", "t.me", "telegram.me",
  "goo.gl", "g.page", "g.co", "business.site",
  "m.me", "messenger.com", "bit.ly", "tinyurl.com", "ow.ly",
  "pagesjaunes.fr", "lafourchette.com", "doctolib.fr", "planity.com", "booksy.com", "fresha.com", "calendly.com", "foursquare.com",
  "resy.com", "zenchef.com",
];
/** Brands with a site per country (tripadvisor.fr, deliveroo.co.uk, google.com/maps…): matched by name, any ending. */
const NOT_OWN_BRANDS = [
  "google", "tripadvisor", "yelp", "thefork", "ubereats", "deliveroo", "just-eat", "justeat", "doordash", "treatwell", "booking", "airbnb",
  "opentable", "sevenrooms", "guestonline", "restaurantguru", "yellowpages",
];
/** A mail provider's own domain in the website column ("gmail.com") is no website at all (exact match: bella.free.fr is theirs). */
const MAIL_DOMAINS = ["gmail.com", "googlemail.com", "yahoo.com", "yahoo.fr", "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr", "live.com", "live.fr",
  "icloud.com", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "laposte.net", "gmx.com", "gmx.fr", "gmx.de", "web.de"];

export type SiteStatus =
  | { has: false; why: "none" } // the CSV gave no website
  | { has: false; why: "profile"; host: string } // only a social / listing / booking page, e.g. facebook.com
  | { has: true; domain: string }; // their own website, e.g. bellavista.fr

const EMAIL = /^[^\s/@]+@[^\s/@]+\.[a-z]{2,}$/i;
// the last label may be an accented (punycode) top-level domain, e.g. .xn--p1ai
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(?:[a-z]{2,}|xn--[a-z0-9-]+)$/;
const OPEN = /^[(<[«"'“‘]+/;
const CLOSE = /[.,;:!?)\]>»"'”’…]+$/;

/** The host of one link, or "" when the token is not a web address (a label like "Site:", an email address…). */
function hostOf(token: string): string {
  // brackets and quotes around it, punctuation after it, a label glued to it ("Site:www.bellavista.fr", not "http://")
  const w = token.trim().replace(OPEN, "").replace(CLOSE, "").replace(/^[a-zà-ÿ]+:(?!\/\/|\d)/i, "");
  if (!w || EMAIL.test(w)) return "";
  // "@le.petit.bistro" (a handle) or "user@host": an @ before the path; one in the path is fine (tiktok.com/@bella)
  const auth = w.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
  if (auth.includes("@")) return "";
  try {
    const host = new URL(/^https?:\/\//i.test(w) ? w : "http://" + w).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!HOST.test(host) || MAIL_DOMAINS.includes(host)) return "";
    // an accented domain comes back as punycode (xn--caf-paris-d4a.fr): keep it the way it was written, for {{website}}
    const typed = auth.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
    return host.includes("xn--") && /[^\x00-\x7f]/.test(typed) ? typed : host;
  } catch { return ""; }
}

/** "booking" in "booking.com" or "booking.co.uk", but not in "booking.my-restaurant.fr" (their own subdomain). */
function isBrand(host: string, brand: string) {
  const parts = host.split(".");
  const i = parts.indexOf(brand);
  return i >= 0 && i < parts.length - 1 && parts.slice(i + 1).every((p) => p.length <= 3);
}

const notOwn = (host: string) => NOT_OWN_HOSTS.some((h) => host === h || host.endsWith("." + h))
  // Google Sites is a real (free) website builder; every other Google address is a map or a listing
  || NOT_OWN_BRANDS.some((b) => isBrand(host, b) && !(b === "google" && host.startsWith("sites.")));

/**
 * A cell may hold several links ("bellavista.fr, facebook.com/bella"), a label ("Site: bellavista.fr") or no web
 * address at all ("-", "n/a"): every link in it is looked at, and one website of their own is enough.
 */
export function siteStatus(website?: string | null): SiteStatus {
  const hosts = (website || "").split(/[\s,;|]+/).map(hostOf).filter(Boolean);
  const own = hosts.find((h) => !notOwn(h));
  if (own) return { has: true, domain: own };
  return hosts.length ? { has: false, why: "profile", host: hosts[0] } : { has: false, why: "none" };
}

export const hasOwnWebsite = (website?: string | null) => siteStatus(website).has;
