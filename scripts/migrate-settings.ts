// One-time: copy the settings saved in the old local SQLite DB (data/app.db) into Firestore,
// and apply gentle warm-up values for a brand-new domain. Safe to run more than once.
import "dotenv/config";
import { existsSync } from "fs";
import { saveSettings, getSettings, type Settings } from "../src/lib/settings";

async function main() {
  let old: Partial<Settings> = {};
  if (existsSync("data/app.db")) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync("data/app.db", { readOnly: true });
    const row = db.prepare("SELECT value FROM KV WHERE key = 'settings'").get() as { value?: string } | undefined;
    if (row?.value) old = JSON.parse(row.value);
    db.close();
    console.log("Found old settings:", Object.keys(old).length, "fields");
  }
  const cur = await getSettings();
  await saveSettings({
    ...old,
    // new domain + single shared mailbox: start slower than the generic defaults
    warmStart: Math.min(old.warmStart ?? cur.warmStart, 5),
    warmStep: Math.min(old.warmStep ?? cur.warmStep, 3),
    warmMax: Math.min(old.warmMax ?? cur.warmMax, 25),
    gapMinMin: Math.max(old.gapMinMin ?? cur.gapMinMin, 8),
    gapMaxMin: Math.max(old.gapMaxMin ?? cur.gapMaxMin, 20),
    dryRun: true,
  });
  const s = await getSettings();
  console.log("Firestore settings now:", { fromEmail: s.fromEmail, smtpHost: s.smtpHost, aiModel: s.aiModel, warm: [s.warmStart, s.warmStep, s.warmMax], gap: [s.gapMinMin, s.gapMaxMin], dryRun: s.dryRun });
}
main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
