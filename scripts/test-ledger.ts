// Live checks against Firestore. No email is ever sent by this script.
//   npm run test:ledger            once-ever rule, in throw-away "outreachtest_" collections (wiped before and after)
//   npm run test:ledger indexes    read-only: runs every indexed query the app uses against the real collections
import "dotenv/config";

const MODE = ["indexes", "gating"].includes(process.argv[2]) ? process.argv[2] : "ledger";
if (MODE === "ledger") process.env.FIRESTORE_PREFIX = "outreachtest_";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
}

async function ledgerTests() {
  const { db, C, key, nowIso } = await import("../src/lib/fsdb");
  const { processRows } = await import("../src/lib/importer");
  const { addToLedger } = await import("../src/lib/ledger");
  const { claimForSend, classify } = await import("../src/lib/sender");

  // ---- SMTP outcome classification: a resend is only ever allowed after a certain refusal ----
  check("smtp: timeout during the transaction is uncertain (never resent)", classify({ stage: "send", code: "ETIMEDOUT", command: "CONN", message: "Timeout" }), "uncertain");
  check("smtp: connection dropped during the transaction is uncertain", classify({ stage: "send", code: "ECONNECTION", command: "CONN", message: "Connection closed unexpectedly" }), "uncertain");
  check("smtp: socket error during the transaction is uncertain", classify({ stage: "send", code: "ESOCKET", command: "CONN" }), "uncertain");
  check("smtp: unknown error shape is uncertain", classify({ message: "something odd" }), "uncertain");
  check("smtp: login check failed before any data may retry later", classify({ stage: "connect", code: "ECONNECTION", command: "CONN" }), "retry");
  check("smtp: DNS failure before any data may retry later", classify({ stage: "connect", code: "EDNS" }), "retry");
  check("smtp: explicit 4xx reply may retry later", classify({ stage: "send", code: "EENVELOPE", command: "RCPT TO", responseCode: 450, response: "450 4.2.0 Greylisted, try again" }), "retry");
  check("smtp: wrong password pauses everything", classify({ stage: "connect", code: "EAUTH", responseCode: 535, response: "535 authentication failed" }), "pause");
  check("smtp: rate limit pauses everything", classify({ stage: "send", code: "EENVELOPE", responseCode: 451, response: "451 4.7.1 rate limit exceeded" }), "pause");
  check("smtp: policy rejection pauses everything", classify({ stage: "send", code: "EMESSAGE", command: "DATA", responseCode: 554, response: "554 5.7.1 message rejected as spam" }), "pause");
  check("smtp: unknown recipient is a hard bounce", classify({ stage: "send", code: "EENVELOPE", command: "RCPT TO", responseCode: 550, response: "550 5.1.1 user unknown" }), "hard");
  check("smtp: unexplained 5xx pauses everything", classify({ stage: "send", code: "EMESSAGE", command: "DATA", responseCode: 554, response: "554 transaction failed" }), "pause");

  const wipe = async () => {
    for (const col of Object.values(C)) {
      if (!col.id.startsWith("outreachtest_")) throw new Error("refusing to wipe a non-test collection: " + col.id);
      await db.recursiveDelete(col);
    }
  };
  await wipe();

  const mkLead = async (email: string, businessKey: string, website?: string) => {
    const id = key(email);
    await C.leads.doc(id).set({ email, businessKey, website: website || null, listId: "t", campaignId: "c", status: "ready", hasMessage: true, createdAt: nowIso(), updatedAt: nowIso() });
    await C.messages.doc(id).create({ leadId: id, leadEmail: email, campaignId: "c", language: "en", subject: "s", body: "b", status: "ready", attempts: 0, dryRunDone: false, createdAt: nowIso() });
    return { id, email, businessKey, website };
  };
  const status = async (col: FirebaseFirestore.CollectionReference, id: string) => (await col.doc(key(id)).get()).get("status");

  // ---- ledger: manual additions ----
  check("ledger: add a new address", await addToLedger(["Info@Mozilla.org"], "manual"), { added: 1, alreadyThere: 0 });
  check("ledger: adding it again changes nothing", await addToLedger(["info@mozilla.org"], "manual"), { added: 0, alreadyThere: 1 });

  // ---- import checks ----
  await C.leads.doc(key("hello@gitlab.com")).set({ email: "hello@gitlab.com", businessKey: "gitlab.com", status: "sent" });
  await C.suppression.doc(key("wikipedia.org")).set({ value: "wikipedia.org", kind: "domain", reason: "test", createdAt: nowIso() });
  await C.contactedBiz.doc(key("python.org")).set({ businessKey: "python.org", status: "sent", at: nowIso() });
  const out = await processRows([
    { email: " Contact@GitHub.com ", businessName: "GitHub" },
    { email: "info@mozilla.org" },
    { email: "hello@gitlab.com" },
    { email: "contact@wikipedia.org" },
    { email: "contact@python.org" },
  ]);
  check("import: fresh address will be sent (normalised)", [out[0].email, out[0].outcome], ["contact@github.com", "send"]);
  check("import: address in the ledger is skipped", [out[1].outcome, out[1].reason], ["skip", "already contacted (in Firebase ledger)"]);
  check("import: address imported before is skipped", [out[2].outcome, out[2].reason], ["skip", "already imported in an earlier list"]);
  check("import: suppressed domain is skipped", [out[3].outcome, out[3].reason], ["skip", "suppressed"]);
  check("import: business already contacted is skipped", [out[4].outcome, out[4].reason], ["skip", "business already contacted (in Firebase ledger)"]);

  // ---- create-only writes ----
  const dup = async (ref: FirebaseFirestore.DocumentReference) => { try { await ref.create({ x: 1 }); return "created"; } catch { return "refused"; } };
  check("lead doc for an existing address cannot be created again", await dup(C.leads.doc(key("hello@gitlab.com"))), "refused");

  // ---- the once-ever gate before sending ----
  const l1 = await mkLead("contact@github.com", "github.com");
  check("send gate: fresh address is claimed", await claimForSend({ id: l1.id, status: "ready" }, l1, "c"), "ok");
  check("send gate: ledger entry written before sending", [await status(C.contacted, l1.email), await status(C.contactedBiz, "github.com"), await status(C.messages, l1.id)], ["sending", "sending", "sending"]);
  check("second message doc for the same lead cannot exist", await dup(C.messages.doc(l1.id)), "refused");
  check("send gate: same message cannot be claimed twice", await claimForSend({ id: l1.id, status: "ready" }, l1, "c"), "lost");
  await C.messages.doc(l1.id).update({ status: "retry" });
  check("send gate: retry of the SAME message after a clear refusal is allowed", await claimForSend({ id: l1.id, status: "retry" }, l1, "c"), "ok");

  const l2 = await mkLead("info@github.com", "github.com");
  check("send gate: another address of an already-contacted business is blocked", await claimForSend({ id: l2.id, status: "ready" }, l2, "c"), "blocked");
  check("blocked lead and message are marked", [await status(C.leads, l2.id), await status(C.messages, l2.id), (await C.contacted.doc(key(l2.email)).get()).exists], ["already_contacted", "blocked", false]);

  const l3 = await mkLead("info@mozilla.org", "mozilla.org");
  check("send gate: address added to the ledger by hand is blocked", await claimForSend({ id: l3.id, status: "ready" }, l3, "c"), "blocked");

  const l4 = await mkLead("contact@wikipedia.org", "wikipedia.org");
  check("send gate: suppressed domain is never sent", await claimForSend({ id: l4.id, status: "ready" }, l4, "c"), "suppressed");

  const l5 = await mkLead("hello@nodejs.org", "nodejs.org");
  const race1 = await Promise.all([claimForSend({ id: l5.id, status: "ready" }, l5, "c"), claimForSend({ id: l5.id, status: "ready" }, l5, "c"), claimForSend({ id: l5.id, status: "ready" }, l5, "c")]);
  check("race: three workers claiming the same message, exactly one wins", race1.sort(), ["lost", "lost", "ok"]);

  const l6 = await mkLead("contact@rust-lang.org", "rust-lang.org");
  const l7 = await mkLead("info@rust-lang.org", "rust-lang.org");
  const race2 = await Promise.all([claimForSend({ id: l6.id, status: "ready" }, l6, "c"), claimForSend({ id: l7.id, status: "ready" }, l7, "c")]);
  check("race: two addresses of one business at the same moment, exactly one wins", race2.sort(), ["blocked", "ok"]);

  await wipe();
  console.log("test collections wiped");
}

async function indexTests() {
  const { C, count } = await import("../src/lib/fsdb");
  const t = "2000-01-01T00:00:00.000Z";
  const queries: [string, () => Promise<unknown>][] = [
    ["drafts: next leads without a draft", () => C.leads.where("campaignId", "==", "x").where("status", "==", "ready").where("hasMessage", "==", false).orderBy("createdAt").limit(1).get()],
    ["samples: first ready leads", () => C.leads.where("campaignId", "==", "x").where("status", "==", "ready").orderBy("createdAt").limit(1).get()],
    ["dashboard: queue size", () => count(C.leads.where("campaignId", "in", ["x", "y"]).where("status", "==", "ready"))],
    ["campaigns: sent count", () => count(C.leads.where("campaignId", "==", "x").where("status", "in", ["sent", "replied"]))],
    ["contacts: by status, newest first", () => C.leads.where("status", "==", "ready").orderBy("updatedAt", "desc").limit(1).get()],
    ["contacts: newest first", () => C.leads.orderBy("updatedAt", "desc").limit(1).get()],
    ["sender: next approved message (dry-run)", () => C.messages.where("campaignId", "==", "x").where("status", "==", "ready").where("dryRunDone", "==", false).where("approved", "==", true).orderBy("createdAt").limit(1).get()],
    ["sender: next approved message (live)", () => C.messages.where("campaignId", "==", "x").where("status", "in", ["ready", "retry"]).where("approved", "==", true).orderBy("createdAt").limit(1).get()],
    ["approve page: drafts waiting", () => C.messages.where("approved", "==", false).where("status", "==", "ready").orderBy("createdAt").limit(1).get()],
    ["dashboard: live sends today", () => count(C.sendLogs.where("ok", "==", true).where("at", ">=", t).where("dryRun", "==", false))],
    ["sent page: one day", () => C.sendLogs.where("at", ">=", t).where("at", "<", "2100-01-01").orderBy("at", "desc").limit(1).get()],
    ["campaign page: latest messages", () => C.messages.where("campaignId", "==", "x").orderBy("createdAt", "desc").limit(1).get()],
    ["guard: last 50 sends", () => C.messages.orderBy("sentAt", "desc").limit(1).get()],
    ["dashboard: total sent", () => count(C.messages.where("status", "in", ["sent", "bounced"]))],
    ["schedule: sent today", () => count(C.sendLogs.where("ok", "==", true).where("at", ">=", t))],
    ["guard: SMTP hard bounces today", () => count(C.sendLogs.where("hardBounce", "==", true).where("at", ">=", t))],
    ["logs: SMTP responses", () => C.sendLogs.orderBy("at", "desc").limit(1).get()],
    ["guard: bounce mails today", () => count(C.replies.where("kind", "==", "bounce").where("receivedAt", ">=", t))],
    ["replies page", () => C.replies.where("kind", "in", ["reply", "optout"]).orderBy("receivedAt", "desc").limit(1).get()],
    ["logs: errors only", () => C.logs.where("level", "==", "error").orderBy("at", "desc").limit(1).get()],
    ["drafts: jobs waiting", () => C.draftJobs.where("nextTryAt", ">", t).limit(1).get()],
    ["ledger page", () => C.contacted.orderBy("at", "desc").limit(1).get()],
    ["suppression page", () => C.suppression.orderBy("createdAt", "desc").limit(1).get()],
  ];
  for (const [name, q] of queries) {
    try { await q(); check(`index: ${name}`, "ok", "ok"); }
    catch (e) { check(`index: ${name}`, (e as Error).message.slice(0, 160), "ok"); }
  }
}

// Approval gate on the real collections: a PAUSED test campaign (invisible to any worker), deleted afterwards. Nothing is sent.
async function gatingTests() {
  const { C, nowIso } = await import("../src/lib/fsdb");
  const { nextMessage } = await import("../src/lib/sender");
  const camp = await C.campaigns.add({ name: "gating self-test (auto-deleted)", listId: "none", timezone: "Asia/Kolkata", language: "en", status: "paused", samplesApproved: false, createdAt: nowIso() });
  const base = { campaignId: camp.id, language: "en", subject: "s", body: "b", attempts: 0, dryRunDone: false };
  const a = C.messages.doc("gating-selftest-a"), b = C.messages.doc("gating-selftest-b");
  try {
    await a.set({ ...base, leadId: "gating-selftest-a", status: "ready", approved: false, createdAt: "2000-01-01T00:00:00.000Z" });
    await b.set({ ...base, leadId: "gating-selftest-b", status: "ready", approved: false, createdAt: "2000-01-02T00:00:00.000Z" });
    const now = new Date();
    check("gate: nothing approved -> nothing to send (dry-run)", (await nextMessage(camp, true, now))?.id ?? null, null);
    check("gate: nothing approved -> nothing to send (live)", (await nextMessage(camp, false, now))?.id ?? null, null);
    await b.update({ approved: true });
    check("gate: only the approved mail is picked, even though an older unapproved one exists (dry-run)", (await nextMessage(camp, true, now))?.id ?? null, "gating-selftest-b");
    check("gate: only the approved mail is picked (live)", (await nextMessage(camp, false, now))?.id ?? null, "gating-selftest-b");
    await b.update({ dryRunDone: true });
    check("gate: after its dry-run the same approved mail is next in LIVE mode", (await nextMessage(camp, false, now))?.id ?? null, "gating-selftest-b");
    check("gate: dry-run does not repeat a mail already delivered to the test address", (await nextMessage(camp, true, now))?.id ?? null, null);
    await b.update({ status: "rejected", approved: false });
    check("gate: rejected mail is never picked", (await nextMessage(camp, false, now))?.id ?? null, null);
  } finally {
    await Promise.all([a.delete(), b.delete(), camp.delete()]);
    console.log("gating test docs deleted");
  }
}

(MODE === "indexes" ? indexTests() : MODE === "gating" ? gatingTests() : ledgerTests()).then(
  () => { console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED"); process.exit(failed ? 1 : 0); },
  (e) => { console.error(e); process.exit(1); },
);
