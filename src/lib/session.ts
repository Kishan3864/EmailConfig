// Session cookie signing with Web Crypto (works in middleware and Node)
const enc = new TextEncoder();

async function hmac(data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(process.env.SESSION_SECRET || "dev-secret-change-me"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const COOKIE = "outreach_session";
const MAX_AGE = 30 * 86400;

export async function makeToken() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  return `${exp}.${await hmac(String(exp))}`;
}

export async function verifyToken(t?: string) {
  if (!t) return false;
  const [exp, sig] = t.split(".");
  if (!exp || !sig || +exp < Date.now() / 1000) return false;
  return (await hmac(exp)) === sig;
}

export { MAX_AGE };
