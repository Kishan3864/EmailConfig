import { C, count, rows, type SendLog } from "./fsdb";
import { getSettings, getState, setState } from "./settings";
import { notify } from "./mailer";
import { DISPLAY_TZ, dayStart, partsIn } from "./time";

const REPORT_HOUR = 23; // Asia/Kolkata

/** Once a day (after 23:00 IST): what went out today, sent to my alert address. Skipped on days with no activity. */
export async function dailyReport() {
  const now = new Date();
  const p = partsIn(now, DISPLAY_TZ);
  if (p.h < REPORT_HOUR) return;
  const st = await getState();
  if (st.lastSummaryDay === p.dayKey) return;
  await setState({ lastSummaryDay: p.dayKey });

  const since = dayStart(now, DISPLAY_TZ).toISOString();
  const logs = rows<SendLog & { subject?: string; business?: string; leadEmail?: string }>(await C.sendLogs.where("at", ">=", since).orderBy("at").get());
  const live = logs.filter((l) => l.ok && !l.dryRun);
  const dry = logs.filter((l) => l.ok && l.dryRun);
  const failed = logs.filter((l) => !l.ok);
  const kinds = async (kind: string) => count(C.replies.where("kind", "==", kind).where("receivedAt", ">=", since));
  const [replies, optouts, bounces] = await Promise.all([kinds("reply"), kinds("optout"), kinds("bounce")]);
  const waiting = await count(C.messages.where("approved", "==", false).where("status", "==", "ready"));
  if (!logs.length && !replies && !optouts && !bounces) return;

  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const line = (l: (typeof logs)[number]) => `${time(l.at)}  ${l.leadEmail || l.to}${l.business ? ` (${l.business})` : ""}  —  ${l.subject || ""}`;
  const s = await getSettings();
  const text = [
    `Outreach report for ${p.dayKey} (times in ${DISPLAY_TZ})`,
    "",
    `Sent to leads (live): ${live.length}`,
    `Dry-run mails to your test address: ${dry.length}`,
    `Failed / not accepted: ${failed.length}`,
    `Replies: ${replies}   Opt-outs: ${optouts}   Hard bounces: ${bounces}`,
    `Drafts waiting for your approval: ${waiting}`,
    `Mode now: ${s.dryRun ? "DRY-RUN" : "LIVE"}`,
    ...(live.length ? ["", "Sent to leads:", ...live.map(line)] : []),
    ...(failed.length ? ["", "Failed:", ...failed.map((l) => `${line(l)}\n    ${l.response}`)] : []),
    "",
    "Open the Sent page in the app to read every mail exactly as it went out.",
  ].join("\n");
  await notify(`Daily report ${p.dayKey}: ${live.length} sent${replies ? `, ${replies} replies` : ""}`, text);
}
