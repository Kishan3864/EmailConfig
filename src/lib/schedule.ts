import { C, count } from "./fsdb";
import { getState, type Settings } from "./settings";
import { dayStart, hm, partsIn, zoned } from "./time";

/** Daily cap for a given number of previous sending days */
export function capFor(s: Settings, priorDays: number) {
  const warm = Math.min(s.warmStart + s.warmStep * priorDays, s.warmMax);
  const plan = s.planDailyLimit > 0 ? Math.floor(s.planDailyLimit * 0.4) : warm;
  return Math.max(0, Math.min(warm, plan));
}

/** Number of distinct earlier days (in tz) with at least one accepted live send */
export async function priorSendingDays(tz: string, now = new Date()) {
  const today = partsIn(now, tz).dayKey;
  const days = (await getState()).sendDays || [];
  return new Set(days.filter((d) => d.startsWith(tz + "|") && d.split("|")[1] < today)).size;
}

/** Accepted sends today (live + dry-run: both count against today's pace) */
export async function sentToday(tz: string, now = new Date()) {
  return count(C.sendLogs.where("ok", "==", true).where("at", ">=", dayStart(now, tz).toISOString()));
}

export async function todayCap(s: Settings, tz: string, now = new Date()) {
  return capFor(s, await priorSendingDays(tz, now));
}

export function windowFor(d: Date, s: Settings, tz: string) {
  const p = partsIn(d, tz);
  const a = hm(s.windowStart), b = hm(s.windowEnd);
  return { open: zoned(p.y, p.m, p.d, a.h, a.m, tz), close: zoned(p.y, p.m, p.d, b.h, b.m, tz), weekday: p.weekday };
}

export function inWindow(d: Date, s: Settings, tz: string) {
  const w = windowFor(d, s, tz);
  return s.sendDays.includes(w.weekday) && d >= w.open && d < w.close;
}

/** Next moment the sending window opens (now if already open) */
export function nextWindowOpen(from: Date, s: Settings, tz: string) {
  for (let i = 0; i < 15; i++) {
    const d = new Date(from.getTime() + i * 86400000);
    const w = windowFor(d, s, tz);
    if (!s.sendDays.includes(w.weekday)) continue;
    if (i === 0) {
      if (from < w.open) return w.open;
      if (from < w.close) return from;
      continue;
    }
    return w.open;
  }
  return from;
}

/** Start of the next allowed sending day after `from` */
export function nextSendingDay(from: Date, s: Settings, tz: string) {
  const w = windowFor(from, s, tz);
  return nextWindowOpen(new Date(w.close.getTime() + 60000), s, tz);
}

/**
 * Simulate the queue to estimate the finish date.
 * `ahead` = messages that will go out before this campaign's first one.
 */
export async function estimateFinish(s: Settings, tz: string, count: number, ahead = 0) {
  if (count <= 0) return null;
  const now = new Date();
  let prior = await priorSendingDays(tz, now);
  let todaySent = await sentToday(tz, now);
  const avgGap = (s.gapMinMin + s.gapMaxMin) / 2;
  let remaining = count + ahead;
  let cursor = nextWindowOpen(now, s, tz);
  for (let guard = 0; guard < 2000 && remaining > 0; guard++) {
    const w = windowFor(cursor, s, tz);
    const isToday = partsIn(cursor, tz).dayKey === partsIn(now, tz).dayKey;
    const minutes = Math.max(0, (w.close.getTime() - cursor.getTime()) / 60000);
    const slots = Math.floor(minutes / avgGap) + 1;
    const cap = capFor(s, prior) - (isToday ? todaySent : 0);
    const n = Math.max(0, Math.min(slots, cap, remaining));
    remaining -= n;
    if (remaining <= 0) return new Date(cursor.getTime() + Math.max(0, n - 1) * avgGap * 60000);
    if (n > 0 || isToday) prior += todaySent > 0 || n > 0 ? 1 : 0;
    todaySent = 0;
    cursor = nextSendingDay(cursor, s, tz);
  }
  return null;
}
