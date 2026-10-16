// The whole mail pipeline against a LOCAL Firestore emulator only: never the real database, never SMTP, never the AI.
//   1. firebase emulators:start --only firestore --project demo-outreach      (needs Java 21+)
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test:pipeline           (the emulator's host:port)
// Checks: Start approves nothing; a draft for every Ready lead; even template rotation; "Text chahiye"; the lead's own
// text; only Approve puts a mail in the send queue; sending window, gap and daily limit; the Ledger blocks a second
// mail to the same business. No mail can be sent: SMTP and AI keys are removed before anything loads.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: set FIRESTORE_EMULATOR_HOST to a local Firestore emulator (this test writes test data).");
  process.exit(1);
}
process.env.FIREBASE_PROJECT_ID = "demo-outreach";
for (const k of ["SMTP_PASSWORD", "IMAP_PASSWORD", "AI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_SERVICE_ACCOUNT"]) delete process.env[k];

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
}

async function main() {
  // wipe the emulator (only an emulator answers this endpoint)
  const wipe = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-outreach/databases/(default)/documents`, { method: "DELETE" });
  if (!wipe.ok) throw new Error("could not clear the emulator: " + wipe.status);

  const { C, nowIso } = await import("../src/lib/fsdb");
  const { DEFAULTS, saveSettings, getSettings, setState } = await import("../src/lib/settings");
  const { draftForLead, ensureDrafts, generateSamples } = await import("../src/lib/drafts");
  const { startCampaignCore, pipeline } = await import("../src/lib/campaign");
  const { approveDraft, approveDrafts } = await import("../src/lib/approval");
  const { nextMessage, claimForSend, trySendOne } = await import("../src/lib/sender");
  const { inWindow, capFor, todayCap, sentToday } = await import("../src/lib/schedule");
  const { zoned } = await import("../src/lib/time");

  await saveSettings({
    ...DEFAULTS, senderName: "Kishan", senderRole: "Web designer", business: "Brighton Solution", fromEmail: "kishan@test.example", testEmail: "me@test.example",
    dryRun: true, sendDays: [1, 2, 3, 4, 5], windowStart: "09:30", windowEnd: "17:30", warmStart: 10, warmStep: 5, warmMax: 30, planDailyLimit: 100,
  });
  const s = await getSettings();
  let n = 0;
  const lead = async (email: string, campaignId: string, extra: Record<string, unknown> = {}) => {
    n++;
    await C.leads.doc(email).set({
      email, businessKey: email.split("@")[1], businessName: `Business ${n}`, website: null, country: "United Kingdom", listId: "L1", campaignId,
      status: "ready", hasMessage: false, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(), updatedAt: nowIso(), ...extra,
    });
  };
  await C.lists.doc("L1").set({ name: "test", sourceNote: "Google Maps", confirmed: true, createdAt: nowIso() });

  // ---- a "by website" campaign: 3 templates for leads without a website, 1 for leads with one ----
  await C.campaigns.doc("CB").set({
    name: "by website", listId: "L1", timezone: "Europe/London", language: "en", mailType: "bysite",
    tplNoSiteIds: ["tpl1", "tpl2", "tpl3"], tplSiteIds: ["tpl4"], rot: { nosite: 0, site: 0 }, status: "draft", samplesApproved: false, createdAt: nowIso(),
  });
  const profiles = ["", "facebook.com/x", "bella.wixsite.com", "instagram.com/y", "https://maps.app.goo.gl/z"];
  for (let i = 0; i < 30; i++) await lead(`nosite${i}@n${i}.example`, "CB", { website: profiles[i % profiles.length] || null });
  for (let i = 0; i < 4; i++) await lead(`site${i}@s${i}.example`, "CB", { website: `https://www.shop${i}.example` });

  // samples are an optional preview, and are never approved
  check("samples: 5 drafts made before Start", (await generateSamples("CB")).length, 0);
  const all = async (cid: string) => (await C.messages.where("campaignId", "==", cid).get()).docs.map((d) => d.data());
  check("samples: none approved", (await all("CB")).filter((m) => m.approved).length, 0);

  // Start approves NOTHING
  await startCampaignCore("CB");
  check("start: campaign running", (await C.campaigns.doc("CB").get()).get("status"), "running");
  check("start: still nothing approved", (await all("CB")).filter((m) => m.approved).length, 0);

  // the worker makes a draft for EVERY Ready lead (template drafts: up to 50 per run)
  await ensureDrafts();
  const msgs = await all("CB");
  check("drafts: one for every Ready lead", msgs.length, 34);
  check("drafts: all waiting for approval", msgs.every((m) => m.status === "ready" && m.approved === false), true);
  check("drafts: no lead left without a draft", (await pipeline("CB")).toCreate, 0);
  const per = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, msgs.filter((m) => m.tplId === id).length]));
  check("rotation: 30 leads without a website spread evenly over 3 templates", per(["tpl1", "tpl2", "tpl3"]), { tpl1: 10, tpl2: 10, tpl3: 10 });
  check("rotation: leads with a website get their group's template", per(["tpl4"]), { tpl4: 4 });
  check("rotation: a Facebook / builder page counts as no website", msgs.filter((m) => /nosite/.test(m.leadId) && m.tplId === "tpl4").length, 0);

  // a second run makes nothing new
  await ensureDrafts();
  check("drafts: a second worker run adds nothing", (await all("CB")).length, 34);

  // ---- only my Approve puts a mail in the send queue ----
  const mon10 = zoned(2026, 10, 19, 10, 0, "Europe/London"); // a Monday, inside the window
  check("queue: nothing to send before any approval", await nextMessage({ id: "CB" }, true, mon10), null);
  const first = msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  check("approve: my click approves", await approveDraft(first.leadId), "ok");
  check("queue: the approved mail is next", (await nextMessage({ id: "CB" }, true, mon10))?.leadId, first.leadId);
  check("approve: a second click on the same mail does nothing", await approveDraft(first.leadId), "gone");
  check("approve: exactly one mail approved", (await all("CB")).filter((m) => m.approved).length, 1);
  const p = await pipeline("CB");
  check("pipeline: counts", [p.toCreate, p.waiting, p.queued, p.sent], [0, 33, 1, 0]);

  // ---- sending rules ----
  check("window: Monday 10:00 is inside", inWindow(mon10, s, "Europe/London"), true);
  check("window: Monday 20:00 is outside", inWindow(zoned(2026, 10, 19, 20, 0, "Europe/London"), s, "Europe/London"), false);
  check("window: Saturday is not a sending day", inWindow(zoned(2026, 10, 24, 11, 0, "Europe/London"), s, "Europe/London"), false);
  check("daily limit: warm-up day 1 = 10, never above the 40% plan cap", [capFor(s, 0), capFor(s, 100), capFor({ ...s, planDailyLimit: 20 }, 100)], [10, 30, 8]);
  for (let i = 0; i < 10; i++) await C.sendLogs.add({ ok: true, dryRun: true, to: "me@test.example", response: "250", at: nowIso() });
  check("daily limit: reached after today's cap", (await sentToday("Europe/London")) >= (await todayCap(s, "Europe/London")), true);
  await setState({ nextSendAt: new Date(Date.now() + 10 * 60000).toISOString() });
  check("gap: the worker waits for the random gap before the next mail", await trySendOne(), "waiting gap");
  await setState({ nextSendAt: null, globalStop: true });
  check("auto-pause: nothing is sent while stopped", await trySendOne(), "stopped");
  await setState({ globalStop: false });

  // ---- the Ledger: one cold mail per address and per business ----
  await C.leads.doc("a@same.example").set({ email: "a@same.example", businessKey: "same.example", listId: "L1", campaignId: "CB", status: "ready", hasMessage: true, createdAt: nowIso(), updatedAt: nowIso() });
  await C.leads.doc("b@same.example").set({ email: "b@same.example", businessKey: "same.example", listId: "L1", campaignId: "CB", status: "ready", hasMessage: true, createdAt: nowIso(), updatedAt: nowIso() });
  for (const id of ["a@same.example", "b@same.example"]) await C.messages.doc(id).set({ leadId: id, campaignId: "CB", status: "ready", approved: true, attempts: 0, createdAt: nowIso() });
  check("ledger: first mail to a business may go", await claimForSend({ id: "a@same.example", status: "ready" }, { id: "a@same.example", email: "a@same.example", businessKey: "same.example" }, "CB"), "ok");
  check("ledger: a second mail to the same business is blocked", await claimForSend({ id: "b@same.example", status: "ready" }, { id: "b@same.example", email: "b@same.example", businessKey: "same.example" }, "CB"), "blocked");

  // ---- Text chahiye + the lead's own text ----
  await saveSettings({
    tpl2Body: [
      "Hello {{contact|there}},",
      "",
      "I'm writing from {{my_business}}. When I looked at {{business}} online, I noticed one thing: {{observation|your site is slow}}. Small details like this can make new customers leave before they call or book.",
      "",
      "We build clear, fast websites for local businesses that work well on phones, and we take care of the design, the text and the technical setup.",
      "",
      "Would it be useful if I sent you two or three ideas for {{business}}, without any obligation?",
    ].join("\n"),
  });
  await C.campaigns.doc("CT").set({ name: "text", listId: "L1", timezone: "Europe/London", language: "en", mailType: "tpl2", status: "running", samplesApproved: true, createdAt: nowIso() });
  await lead("obs@o.example", "CT", { observation: "the menu on your website is a photo that is hard to read on a phone" });
  await lead("noobs@o.example", "CT");
  const ownBody = ["Hello Marco,", "", "This is a mail written just for you in the import file. " + "It explains in plain words what we could do for your restaurant and your customers. ".repeat(4), "", "Would you like to see a first idea?"].join("\n");
  await lead("own@o.example", "CT", { customSubject: "a first idea for your restaurant", customBody: ownBody });
  await lead("CAPS@chiraz.example", "CT", { businessName: "CAFÉ DE CHIRAZ", observation: "the opening hours on your site are from last year" });
  for (const id of ["obs@o.example", "noobs@o.example", "own@o.example", "CAPS@chiraz.example"]) await draftForLead(id);
  const ct = Object.fromEntries((await all("CT")).map((m) => [m.leadId, m]));
  check("text: with an observation the draft is ready", ct["obs@o.example"]?.status, "ready");
  check("text: without one it waits for my words (no fallback used)", [ct["noobs@o.example"]?.status, /\[OBSERVATION\]/.test(ct["noobs@o.example"]?.body), /slow/.test(ct["noobs@o.example"]?.body)], ["needs_text", true, false]);
  check("text: a draft needing my words cannot be approved", await approveDraft("noobs@o.example"), "needs_text");
  check("own text: the lead's own subject and body are used", [ct["own@o.example"]?.custom, ct["own@o.example"]?.subject, ct["own@o.example"]?.tplId], [true, "a first idea for your restaurant", null]);
  check("caps: a business name in capitals does not block the draft", ct["CAPS@chiraz.example"]?.status, "ready");
  const bulk = await approveDrafts(["obs@o.example", "noobs@o.example", "own@o.example"]);
  check("approve selected: approves only complete drafts", [bulk.ok, bulk.needsText, bulk.gone], [2, 1, 0]);

  // ---- a template that breaks a rule waits for my edit once, instead of being retried for ever ----
  await saveSettings({ tpl3Body: "Hello {{business}}, this is too short to pass. Would you like ideas?" });
  await C.campaigns.doc("CR").set({ name: "rules", listId: "L1", timezone: "Europe/London", language: "en", mailType: "tpl3", status: "running", samplesApproved: true, createdAt: nowIso() });
  await lead("short@r.example", "CR");
  await draftForLead("short@r.example");
  const short = (await C.messages.doc("short@r.example").get()).data();
  check("rules: a failing template is stored once as 'Text chahiye' with the reasons", [short?.status, short?.approved, (short?.problems || []).some((p: string) => /words/.test(p))], ["needs_text", false, true]);
  check("rules: no retry job is left behind", (await C.draftJobs.doc("short@r.example").get()).exists, false);
  check("rules: the lead is not picked up again", (await C.leads.doc("short@r.example").get()).get("hasMessage"), true);

  // ---- I approve exactly the text I read ----
  const { textKey } = await import("../src/lib/english");
  const m2 = (await C.messages.doc("CAPS@chiraz.example").get()).data()!;
  check("version: an old text key is refused", await approveDraft("CAPS@chiraz.example", textKey("old", "text")), "changed");
  check("version: the key of the text shown approves", await approveDraft("CAPS@chiraz.example", textKey(m2.subject, m2.body)), "ok");

  // ---- a lead that may no longer be mailed never blocks the approved queue behind it ----
  const { withdrawDraft } = await import("../src/lib/approval");
  const ids = (await C.messages.where("campaignId", "==", "CB").where("status", "==", "ready").get()).docs.map((d) => d.id).sort();
  const [x1, x2] = ids.filter((id) => id !== first.leadId);
  await C.leads.doc(x1).update({ status: "suppressed" });
  check("approve: a lead on the block list cannot be approved", await approveDraft(x1), "gone");
  await approveDraft(x2);
  await C.leads.doc(x2).update({ status: "opted_out" }); // opted out after my approval
  await withdrawDraft(x2, "opted out");
  const x2m = (await C.messages.doc(x2).get()).data();
  check("withdraw: the mail leaves the queue for good", [x2m?.status, x2m?.approved], ["blocked", false]);
  check("withdraw: the next approved mail is still sent", (await nextMessage({ id: "CB" }, true, mon10))?.leadId, first.leadId);

  console.log(failed ? `\n${failed} FAILED` : "\nAll checks passed");
}
main().then(() => process.exit(failed ? 1 : 0), (e) => { console.error(e); process.exit(1); });
