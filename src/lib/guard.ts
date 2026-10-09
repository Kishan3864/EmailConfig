import { prisma } from "./db";
import { getState, setState } from "./settings";
import { log } from "./log";
import { notify } from "./mailer";
import { dayStart } from "./time";

/** Stop all sending, raise the red alert and email me. */
export async function emergencyStop(reason: string) {
  const st = await getState();
  await setState({ globalStop: true, alert: { message: reason, at: new Date().toISOString() } });
  await prisma.campaign.updateMany({ where: { status: "running" }, data: { status: "paused" } });
  await log("error", "guard", `AUTO-PAUSE: ${reason}`);
  if (!st.alert) await notify("Sending auto-paused", `All campaigns were paused automatically.\n\nReason: ${reason}\n\nOpen the dashboard, fix the cause, then clear the alert and resume.`);
}

export async function canSend() {
  const st = await getState();
  return !st.globalStop && !st.alert;
}

/** Bounce thresholds: 2 hard bounces in one day, or >5% over the last 50 sends */
export async function checkBounceThresholds(tz = "Asia/Kolkata") {
  const today = await prisma.reply.count({ where: { kind: "bounce", receivedAt: { gte: dayStart(new Date(), tz) } } });
  const smtpToday = await prisma.message.count({ where: { status: "bounced", sentAt: null, sendStartedAt: { gte: dayStart(new Date(), tz) } } });
  if (today + smtpToday >= 2) return emergencyStop(`${today + smtpToday} hard bounces today`);
  const last = await prisma.message.findMany({ where: { sentAt: { not: null } }, orderBy: { sentAt: "desc" }, take: 50, select: { status: true } });
  if (last.length >= 10) {
    const rate = last.filter((m) => m.status === "bounced").length / last.length;
    if (rate > 0.05) return emergencyStop(`bounce rate ${(rate * 100).toFixed(1)}% over the last ${last.length} sends`);
  }
}
