import { prisma } from "./db";

export async function log(level: "info" | "warn" | "error", scope: string, message: string) {
  // never log secrets: callers pass only non-sensitive text
  const clean = message.replace(/(pass(word)?|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, "$1=***").slice(0, 4000);
  console.log(`[${new Date().toISOString()}] ${level.toUpperCase()} ${scope}: ${clean}`);
  await prisma.log.create({ data: { level, scope, message: clean } }).catch(() => {});
}

export async function event(leadId: number, type: string, detail?: string) {
  await prisma.event.create({ data: { leadId, type, detail: detail?.slice(0, 4000) } }).catch(() => {});
}
