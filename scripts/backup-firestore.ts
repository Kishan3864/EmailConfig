// Read-only backup of every outreach collection (and each lead's events) to backups/firestore-<time>/<collection>.json.
//   npm run backup
// Timestamps and other Firestore types are written as plain JSON (ISO strings stay strings). Nothing is changed.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { C, EVENTS } from "../src/lib/fsdb";

async function main() {
  const dir = join("backups", `firestore-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(dir, { recursive: true });
  let total = 0;
  for (const [name, col] of Object.entries(C)) {
    const snap = await col.get();
    const docs: Record<string, unknown> = {};
    for (const d of snap.docs) docs[d.id] = d.data();
    if (name === "leads") {
      // each lead's history lives in a subcollection
      const events: Record<string, Record<string, unknown>> = {};
      for (const d of snap.docs) {
        const ev = await d.ref.collection(EVENTS).get();
        if (!ev.empty) events[d.id] = Object.fromEntries(ev.docs.map((e) => [e.id, e.data()]));
      }
      writeFileSync(join(dir, `${col.id}__${EVENTS}.json`), JSON.stringify(events, null, 1));
    }
    writeFileSync(join(dir, `${col.id}.json`), JSON.stringify(docs, null, 1));
    console.log(`${col.id}: ${snap.size}`);
    total += snap.size;
  }
  console.log(`${total} documents saved in ${dir}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
