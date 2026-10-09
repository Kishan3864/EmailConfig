export const DISPLAY_TZ = "Asia/Kolkata";

export function fmt(d: Date | string | null | undefined, tz = DISPLAY_TZ) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(d));
}
export function fmtDate(d: Date | string | null | undefined, tz = DISPLAY_TZ) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(d));
}

/** Wall-clock parts of a date in a timezone. weekday: 1=Mon..7=Sun */
export function partsIn(d: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 1;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, weekday: wd, dayKey: `${p.year}-${p.month}-${p.day}` };
}

/** UTC Date for a wall-clock time in tz */
export function zoned(y: number, m: number, d: number, h: number, min: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess;
  for (let i = 0; i < 3; i++) {
    const p = partsIn(new Date(t), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    t += guess - asUtc;
  }
  return new Date(t);
}

export function hm(s: string) {
  const [h, m] = s.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

/** Start of the local day (00:00) in tz */
export function dayStart(d: Date, tz: string) {
  const p = partsIn(d, tz);
  return zoned(p.y, p.m, p.d, 0, 0, tz);
}
