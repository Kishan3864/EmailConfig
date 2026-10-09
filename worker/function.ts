// Firebase scheduled Cloud Function: runs the worker tick every 2 minutes.
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { runTick } from "../src/lib/tick";

const SMTP_PASSWORD = defineSecret("SMTP_PASSWORD");
const AI_API_KEY = defineSecret("AI_API_KEY");

export const outreachTick = onSchedule(
  {
    schedule: "every 2 minutes",
    region: "asia-south1",
    timeoutSeconds: 300,
    memory: "512MiB",
    maxInstances: 1,
    retryCount: 0, // never re-run a tick automatically (a re-run could repeat a send attempt)
    secrets: [SMTP_PASSWORD, AI_API_KEY],
  },
  async () => {
    const r = await runTick();
    console.log("tick:", r);
  },
);
