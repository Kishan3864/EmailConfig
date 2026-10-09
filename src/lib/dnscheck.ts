import { promises as dns } from "dns";

const mxCache = new Map<string, boolean>();
export async function hasMx(domain: string): Promise<boolean> {
  if (mxCache.has(domain)) return mxCache.get(domain)!;
  let ok = false;
  try {
    const mx = await Promise.race([dns.resolveMx(domain), new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 8000))]);
    ok = mx.some((m) => m.exchange && m.exchange !== ".");
  } catch { ok = false; }
  mxCache.set(domain, ok);
  return ok;
}

async function txt(name: string) {
  try { return (await dns.resolveTxt(name)).map((r) => r.join("")); } catch { return []; }
}

export async function checkDomain(domain: string, selector: string) {
  const d = domain.trim().toLowerCase();
  const spfRec = (await txt(d)).find((t) => t.toLowerCase().startsWith("v=spf1"));
  const dkimRec = (await txt(`${selector}._domainkey.${d}`)).find((t) => /v=dkim1|p=/i.test(t));
  let dkimCname = "";
  if (!dkimRec) { try { dkimCname = (await dns.resolveCname(`${selector}._domainkey.${d}`))[0] || ""; } catch {} }
  const dmarcRec = (await txt(`_dmarc.${d}`)).find((t) => t.toLowerCase().startsWith("v=dmarc1"));
  return {
    spf: !!spfRec, dkim: !!dkimRec || !!dkimCname, dmarc: !!dmarcRec,
    detail: [`SPF: ${spfRec || "missing"}`, `DKIM (${selector}): ${dkimRec ? dkimRec.slice(0, 80) + "…" : dkimCname ? "CNAME " + dkimCname : "missing"}`, `DMARC: ${dmarcRec || "missing"}`].join("\n"),
    at: new Date().toISOString(),
  };
}
