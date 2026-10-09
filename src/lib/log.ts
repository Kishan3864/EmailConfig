import { C, nowIso } from "./fsdb";

export async function log(level: "info" | "warn" | "error", scope: string, message: string) {
  // never log secrets: callers pass only non-sensitive text
  const clean = message.replace(/(pass(word)?|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, "$1=***").slice(0, 4000);
  console.log(`[${nowIso()}] ${level.toUpperCase()} ${scope}: ${clean}`);
  await C.logs.add({ level, scope, message: clean, at: nowIso() }).catch(() => {});
}

export async function event(leadId: string, type: string, detail?: string) {
  await C.leads.doc(leadId).collection("events").add({ type, detail: detail?.slice(0, 4000) ?? null, at: nowIso() }).catch(() => {});
}
