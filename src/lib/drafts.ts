import { FieldValue } from "firebase-admin/firestore";
import { C, db, nowIso, rows, type Campaign, type Lead } from "./fsdb";
import { getSettings, getState, type Settings } from "./settings";
import { fetchFacts, type Facts } from "./facts";
import { generateDraft } from "./ai";
import { capsAllowed, fillForLead, isTemplateId, mailPlan, missingMark, rotate, templateOf, templatesForLead, templateVars, type TemplateId } from "./templates";
import { aiPaused, ensureTranslation, pauseAi } from "./translate";
import { validateDraft } from "./validate";
import { log, event } from "./log";

// After Start the worker makes a draft for EVERY Ready lead of the campaign, a batch per cycle. None is ever approved
// here: every draft waits on the Approve page for my own click (lib/approval.ts).
const FILL_PER_TICK = 50; // template / own-text drafts per worker cycle (no AI call; their English is made later)
const AI_PER_TICK = 3; // AI drafts per worker cycle (free API limits)
const AI_MAX_TRIES = 5; // after this many failed AI tries a lead's draft waits for my own text instead of being retried

type DraftOpts = {
  translateNow?: boolean; // make the English right away (samples, a new version); the worker's batches leave it to ensureTranslations
  prefer?: string | null; // keep this template if the lead may still get it (a new version of the same draft)
  settings?: Settings; // the worker reads these once per cycle instead of once per lead
  campaign?: Campaign;
};

/** The lead's own subject + body from the import file, used instead of a template or the AI when both are there. */
const ownText = (l: Lead) => ((l.customSubject || "").trim() && (l.customBody || "").trim() ? { subject: l.customSubject!, body: l.customBody! } : null);

/**
 * The template a lead gets: the preferred one if still allowed, the only one, or the next in turn for its group
 * (round-robin: the group's n-th draft gets template n modulo the number ticked; counted only once the draft exists).
 */
function chooseTemplate(c: Campaign, ids: TemplateId[], group: "nosite" | "site" | null, prefer?: string | null) {
  if (isTemplateId(prefer) && ids.includes(prefer)) return { id: prefer, counted: false };
  if (ids.length === 1 || !group) return { id: ids[0], counted: false };
  return { id: rotate(ids, c.rot?.[group] || 0), counted: true };
}

/**
 * Make + check the draft for one lead. Stored only if it passes the rules, and always unapproved.
 * A template needing {{observation}} for a lead without one is stored as "needs_text" (Text chahiye): I write that part.
 */
export async function draftForLead(leadId: string, opts: DraftOpts = {}): Promise<{ ok: boolean; error?: string }> {
  const s = opts.settings || (await getSettings());
  const ld = await C.leads.doc(leadId).get();
  if (!ld.exists) return { ok: false, error: "lead not found" };
  const lead = { id: ld.id, ...ld.data() } as Lead;
  if (!lead.campaignId) return { ok: false, error: "lead not in a campaign" };
  if ((await C.messages.doc(leadId).get()).exists) {
    // a draft is already there: make sure the lead says so, or the worker would pick it up again on every cycle
    if (lead.hasMessage !== true) await ld.ref.update({ hasMessage: true });
    return { ok: true };
  }
  // the worker passes the campaign it already read (the same object for its whole batch, so the rotation counter
  // below stays current from one lead to the next); single calls read it here
  const campaign = opts.campaign?.id === lead.campaignId ? opts.campaign : ({ id: lead.campaignId, ...(await C.campaigns.doc(lead.campaignId).get()).data() } as Campaign);
  const campRef = C.campaigns.doc(campaign.id);
  const own = ownText(lead);
  // a template campaign fills a fixed text from Settings (a "by website" campaign picks it by the lead's website);
  // only AI campaigns need the homepage facts
  const choice = own ? null : templatesForLead(campaign, lead.website);
  const pick = choice ? chooseTemplate(campaign, choice.ids, choice.group, opts.prefer) : null;

  let facts: Facts | null = null;
  if (!own && !pick) {
    if (lead.facts) facts = JSON.parse(lead.facts);
    else {
      facts = await fetchFacts(lead.website); // fetched once, then stored
      await ld.ref.update({ facts: JSON.stringify(facts), factsAt: nowIso() });
    }
  }

  const jobRef = C.draftJobs.doc(leadId);
  const job = await jobRef.get();
  // stores the draft, the lead's hasMessage and the rotation count together, so they can never get out of step;
  // create() fails if a message already exists -> never two messages for one lead
  const store = async (d: { subject: string; body: string; missing: string[]; problems: string[] }) => {
    const needsText = d.missing.length > 0 || d.problems.length > 0;
    // a mail not in English gets its English version (right away or from the worker); one still needing my text, after I write it
    const translate = campaign.language !== "en" && !needsText;
    const b = db.batch();
    b.create(C.messages.doc(leadId), {
      leadId, leadEmail: lead.email, businessName: lead.businessName || null, campaignId: campaign.id, language: campaign.language,
      subject: d.subject, body: d.body, tplId: pick?.id ?? null, custom: !!own, missing: d.missing, problems: d.problems,
      subjectEn: null, bodyEn: null, enFor: null, enNeeded: translate, enRetryAt: translate ? nowIso() : null, enTries: 0, enError: null,
      status: needsText ? "needs_text" : "ready", attempts: 0, dryRunDone: false, createdAt: nowIso(),
      // never approved here: only my own click on the Approve page approves a draft (lib/approval.ts)
      approved: false, approvedAt: null,
    });
    b.update(ld.ref, { hasMessage: true });
    const counted = pick?.counted && choice?.group ? choice.group : null;
    if (counted) b.update(campRef, { [`rot.${counted}`]: FieldValue.increment(1) });
    await b.commit();
    if (counted) { const rot = (campaign.rot ||= {}); rot[counted] = (rot[counted] || 0) + 1; }
    if (job.exists) await jobRef.delete().catch(() => {});
    const from = pick ? ` from ${pick.id}` : own ? " from the lead's own text" : "";
    await event(leadId, "draft", d.problems.length ? `draft waiting for my text (rules: ${d.problems.join("; ").slice(0, 200)})${from}` : `${needsText ? "draft waiting for my text" : "validated draft created"}${from}`);
    if (translate && opts.translateNow) await ensureTranslation(leadId).catch(() => {}); // never fails the draft: the worker retries
  };
  try {
    if (own || pick) {
      const vars = templateVars(lead, s);
      const src = own || templateOf(s, pick!.id);
      const f = fillForLead(src.subject, src.body, vars);
      // a missing detail: the other rules are checked on the text around it (its length is unknown until I write it)
      const plain = (t: string) => f.missing.reduce((x, k) => x.split(missingMark(k)).join(k), t);
      const problems = validateDraft(plain(f.subject), plain(f.body), campaign.language, lead.businessName || "", capsAllowed(vars))
        .filter((e) => !(f.missing.length && /^body has \d+ words/.test(e)));
      // a template or own text that breaks a rule would break it again on every try: it is stored once, waiting for my
      // edit ("Text chahiye", with the reasons), instead of being retried for ever
      await store({ subject: f.subject, body: f.body, missing: f.missing, problems });
    } else {
      const d = await generateDraft(lead, facts!, campaign.language, s);
      if (d.errors.length) throw new Error("validation: " + d.errors.join("; "));
      await store({ subject: d.subject, body: d.body, missing: [], problems: [] });
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ALREADY_EXISTS/i.test(msg)) { await ld.ref.update({ hasMessage: true }); return { ok: true }; }
    const attempts = ((job.exists && job.get("attempts")) || 0) + 1;
    if (/HTTP 429|rate.?limit/i.test(msg)) await pauseAi();
    await log("warn", "ai", `draft failed for ${lead.email} (attempt ${attempts}): ${msg.slice(0, 300)}`);
    // an AI draft that keeps failing stops being retried: it waits for my own text, with the last reason
    if (attempts >= AI_MAX_TRIES && !/HTTP 429|rate.?limit/i.test(msg)) {
      try {
        await store({ subject: "", body: "", missing: [], problems: msg.startsWith("validation: ") ? msg.slice(12).split("; ") : [msg.slice(0, 300)] });
        return { ok: false, error: msg };
      } catch { /* fall through to one more retry later */ }
    }
    const wait = Math.min(15 * attempts, 360) * 60000;
    await jobRef.set({ attempts, lastError: msg.slice(0, 500), nextTryAt: new Date(Date.now() + wait).toISOString(), campaignId: campaign.id });
    return { ok: false, error: msg };
  }
}

/**
 * After Start: a draft for every Ready lead of every started campaign that has none yet, a batch per worker cycle
 * (template / own-text drafts up to FILL_PER_TICK, AI drafts up to AI_PER_TICK). All wait for my approval.
 */
export async function ensureDrafts() {
  const st = await getState();
  const aiOff = aiPaused() || (!!st.aiBackoffUntil && new Date(st.aiBackoffUntil) > new Date());
  const campaigns = rows<Campaign>(await C.campaigns.where("status", "==", "running").get()).filter((c) => c.samplesApproved).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!campaigns.length) return;
  // only AI drafts are retried (template drafts never fail into the retry queue), and at most AI_MAX_TRIES times
  const waiting = new Set((await C.draftJobs.where("nextTryAt", ">", nowIso()).limit(100).get()).docs.map((d) => d.id));
  const s = await getSettings();
  let fill = FILL_PER_TICK, ai = AI_PER_TICK;
  for (const c of campaigns) {
    // a template campaign needs no AI, so it goes on while the AI is paused
    const usesAi = mailPlan(c).kind === "ai";
    if (usesAi ? aiOff || ai <= 0 : fill <= 0) continue;
    const want = usesAi ? ai : fill;
    const cands = (await C.leads.where("campaignId", "==", c.id).where("status", "==", "ready").where("hasMessage", "==", false).orderBy("createdAt").limit(want + Math.min(waiting.size, 20)).get()).docs;
    for (const l of cands) {
      if (usesAi ? ai <= 0 : fill <= 0) break;
      if (waiting.has(l.id)) continue;
      const r = await draftForLead(l.id, { settings: s, campaign: c });
      if (usesAi) ai--; else fill--;
      // a rate limit pauses the AI for the rest of the cycle; template drafts carry on
      if (usesAi && ((!r.ok && /HTTP 429/.test(r.error || "")) || aiPaused())) break;
    }
  }
}

/** Up to 5 sample drafts of a campaign, an optional preview before Start. Never approved by this either. */
export async function generateSamples(campaignId: string) {
  const leads = (await C.leads.where("campaignId", "==", campaignId).where("status", "==", "ready").orderBy("createdAt").limit(5).get()).docs;
  const errors: string[] = [];
  for (const l of leads) {
    if ((await C.messages.doc(l.id).get()).exists) continue;
    await C.draftJobs.doc(l.id).delete().catch(() => {});
    const r = await draftForLead(l.id, { translateNow: true });
    if (!r.ok) errors.push(`${l.get("email")}: ${r.error}`);
  }
  return errors;
}
