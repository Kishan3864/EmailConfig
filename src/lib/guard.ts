import { C, count, nowIso } from "./fsdb";
import { getState, setState } from "./settings";
import { log } from "./log";
import { notify } from "./mailer";
import { dayStart } from "./time";

/** Stop all sending, raise the red alert and email me. */
export async function emergencyStop(reason: string) {
  const st = await getState();
  await setState({ globalStop: true, alert: { message: reason, at: nowIso() } });
  const running = await C.campaigns.where("status", "==", "running").get();
  await Promise.all(running.docs.map((d) => d.ref.update({ status: "paused" })));
  await log("error", "guard", `AUTO-PAUSE: ${reason}`);
  if (!st.alert) await notify("Sending auto-paused", `All campaigns were paused automatically.\n\nReason: ${reason}\n\nOpen the dashboard, fix the cause, then clear the alert and resume.`);
}

export async function canSend() {
  const st = await getState();
  return !st.globalStop && !st.alert;
}

/** Bounce thresholds: 2 hard bounces in one day, or >5% over the last 50 sends */
export async function checkBounceThresholds(tz = "Asia/Kolkata") {
  const since = dayStart(new Date(), tz).toISOString();
  const today = await count(C.replies.where("kind", "==", "bounce").where("receivedAt", ">=", since));
  const smtpToday = await count(C.sendLogs.where("hardBounce", "==", true).where("at", ">=", since));
  if (today + smtpToday >= 2) return emergencyStop(`${today + smtpToday} hard bounces today`);
  const last = (await C.messages.orderBy("sentAt", "desc").limit(50).get()).docs.map((d) => d.get("status"));
  if (last.length >= 10) {
    const rate = last.filter((s) => s === "bounced").length / last.length;
    if (rate > 0.05) return emergencyStop(`bounce rate ${(rate * 100).toFixed(1)}% over the last ${last.length} sends`);
  }
}
