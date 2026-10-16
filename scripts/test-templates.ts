// Offline checks (no Firestore, no AI, no mail): which template a lead gets, how templates are filled,
// and when a stored English translation still counts.
//   npm run test:templates
import { DEFAULTS, type Settings } from "../src/lib/settings";
import { TEMPLATE_IDS, capsAllowed, fillForLead, fillTemplate, mailPlan, rotate, suggestGroup, templateForLead, templateOf, templatesForLead, templateVars } from "../src/lib/templates";
import { siteStatus } from "../src/lib/website";
import { englishOf, textKey } from "../src/lib/english";
import { validateDraft } from "../src/lib/validate";
import { detectLang } from "../src/lib/lang";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
}

// ---- own website or not: only the CSV value counts; profile / map / listing links are not a website ----
const has = (w: string | null) => siteStatus(w).has;
check("site: empty is no website", has(""), false);
check("site: null is no website", has(null), false);
check("site: a dash or n/a is no website", [has("-"), has("n/a"), has("non")], [false, false, false]);
check("site: own domain", siteStatus("https://www.bellavista.fr/menu"), { has: true, domain: "bellavista.fr" });
check("site: own subdomain named booking is still their own", has("https://booking.bellavista.fr"), true);
check("site: a free or temporary builder page is not a website of their own", ["bella.wixsite.com/site", "sites.google.com/view/bella", "bella.eatbu.com", "lepetit.metro.rest", "bella.framer.website", "bella.myshopify.com", "bella.mailchimpsites.com", "bella.ody.app", "bella.webflow.io", "bella.business.site"].map(has), [false, false, false, false, false, false, false, false, false, false]);
check("site: social profiles are not a website", [has("facebook.com/bella"), has("https://m.facebook.com/x"), has("instagram.com/x"), has("tiktok.com/@x")], [false, false, false, false]);
check("site: link-in-bio and chat links are not a website", [has("linktr.ee/x"), has("https://wa.me/33600000000")], [false, false]);
check("site: maps and listings are not a website", [has("https://maps.app.goo.gl/abc"), has("https://www.google.com/maps/place/x"), has("g.page/x"), has("x.business.site"), has("tripadvisor.co.uk/x"), has("pagesjaunes.fr/pros/1")], [false, false, false, false, false, false]);
check("site: booking / delivery platforms are not a website", [has("https://www.booking.com/hotel/x"), has("thefork.fr/x"), has("www.ubereats.com/fr/store/x"), has("deliveroo.co.uk/menu/x")], [false, false, false, false]);
check("site: profile reason names the host", siteStatus("https://www.facebook.com/bella"), { has: false, why: "profile", host: "facebook.com" });
const own = { has: true, domain: "bellavista.fr" };
check("site: several links in one cell, own site anywhere", [siteStatus("bellavista.fr, facebook.com/x"), siteStatus("https://www.facebook.com/bella, https://bellavista.fr"), siteStatus("https://bellavista.fr | https://facebook.com/x")], [own, own, own]);
check("site: labels, brackets, trailing punctuation and line breaks", [siteStatus("Site: bellavista.fr"), siteStatus("bellavista.fr;"), siteStatus("bellavista.fr\nfacebook.com/x"), siteStatus("(bellavista.fr)")], [own, own, own, own]);
check("site: only profiles in one cell", siteStatus("facebook.com/x / instagram.com/y"), { has: false, why: "profile", host: "facebook.com" });
check("site: an email address is not a website", siteStatus("info@gmail.com"), { has: false, why: "none" });
check("site: a profile path with @ is still that profile", siteStatus("https://www.tiktok.com/@bella"), { has: false, why: "profile", host: "tiktok.com" });
check("site: a social handle is not a website", [siteStatus("@le.petit.bistro"), siteStatus("Instagram: @le.petit.bistro"), siteStatus("https://@bellavista.fr")], [{ has: false, why: "none" }, { has: false, why: "none" }, { has: false, why: "none" }]);
check("site: glued labels, quotes and trailing marks", [siteStatus("Site:www.bellavista.fr"), siteStatus("Website:bellavista.fr"), siteStatus("Site:http://bellavista.fr"), siteStatus("«bellavista.fr»"), siteStatus("“bellavista.fr”"), siteStatus("\"bellavista.fr\""), siteStatus("bellavista.fr!"), siteStatus("bellavista.fr…")], [own, own, own, own, own, own, own, own]);
check("site: an accented domain keeps its letters", siteStatus("https://www.café-paris.fr/menu"), { has: true, domain: "café-paris.fr" });
check("site: booking pages, chat links and short links are not a website", [has("https://www.opentable.fr/r/bella"), has("https://bookings.zenchef.com/results?rid=1"), has("https://m.me/bella"), has("https://bit.ly/3abc"), has("restaurantguru.com/x")], [false, false, false, false, false]);
check("site: a mail provider's domain is no website, a site on its subdomain is", [siteStatus("gmail.com"), siteStatus("orange.fr"), has("bellavista.free.fr")], [{ has: false, why: "none" }, { has: false, why: "none" }, true]);
check("site: a port or an IP address", [siteStatus("bellavista.fr:8080"), has("192.168.1.10")], [own, false]);

// ---- which template a lead gets ----
const bysite = { mailType: "bysite", tplNoSite: "tpl3", tplSite: "tpl6" };
check("route: by website, no website -> nosite template", templateForLead(bysite, "")?.id, "tpl3");
check("route: by website, facebook page -> nosite template", templateForLead(bysite, "facebook.com/x")?.id, "tpl3");
check("route: by website, own website -> site template", templateForLead(bysite, "bella.fr")?.id, "tpl6");
check("route: one template for everyone", [templateForLead({ mailType: "tpl2" }, "")?.id, templateForLead({ mailType: "tpl2" }, "bella.fr")?.id], ["tpl2", "tpl2"]);
check("route: AI campaign (also without mailType) uses no template", [templateForLead({ mailType: "ai" }, "x.fr"), templateForLead({}, null)], [null, null]);
check("route: by website with one id missing uses the other for everyone", mailPlan({ mailType: "bysite", tplSite: "tpl6" }), { kind: "bysite", nosite: ["tpl6"], site: ["tpl6"] });
const multi = { mailType: "bysite", tplNoSiteIds: ["tpl3", "tpl5", "tpl1"], tplSiteIds: ["tpl4", "tpl6"] };
check("route: 1-3 templates per group", [templatesForLead(multi, "")?.ids, templatesForLead(multi, "bella.fr")?.ids, templatesForLead(multi, "")?.group], [["tpl3", "tpl5", "tpl1"], ["tpl4", "tpl6"], "nosite"]);
check("route: more than 3 ticked are cut to 3, unknown ids dropped", mailPlan({ mailType: "bysite", tplNoSiteIds: ["tpl1", "x", "tpl2", "tpl3", "tpl4"], tplSiteIds: ["tpl6"] }), { kind: "bysite", nosite: ["tpl1", "tpl2", "tpl3"], site: ["tpl6"] });
check("route: a draft shows the template it was made from", templateForLead(multi, "", "tpl5")?.id, "tpl5");
// round-robin: 30 leads over 3 templates -> 10 each; 5 over 2 -> 3 and 2
const spread = (ids: string[], n: number) => { const c: Record<string, number> = {}; for (let i = 0; i < n; i++) { const id = rotate(ids, i); c[id] = (c[id] || 0) + 1; } return c; };
check("rotate: even over 3 templates", spread(["tpl3", "tpl5", "tpl1"], 30), { tpl3: 10, tpl5: 10, tpl1: 10 });
check("rotate: as even as possible over 2", spread(["tpl4", "tpl6"], 5), { tpl4: 3, tpl6: 2 });

// ---- the pair the campaign form suggests ----
const s: Settings = { ...DEFAULTS, senderName: "Kishan", business: "Brighton Solution" };
const choices = TEMPLATE_IDS.map((id) => { const x = templateOf(s, id); return { id, for: x.for, lang: detectLang(fillTemplate(x.body, templateVars({ businessName: "Bella Vista" }, s))) }; });
check("suggest: French campaign ticks the French templates of each group", [suggestGroup(choices, "fr", "nosite"), suggestGroup(choices, "fr", "site")], [["tpl5"], ["tpl6"]]);
check("suggest: English campaign ticks the English ones (no-website group: own tag first)", [suggestGroup(choices, "en", "nosite"), suggestGroup(choices, "en", "site")], [["tpl3"], ["tpl4"]]);
check("suggest: nothing in the campaign language ticks nothing (no other-language fallback)", suggestGroup(choices, "de", "site"), []);
check("suggest: at most 3 per group", suggestGroup(TEMPLATE_IDS.map((id) => ({ id, for: "nosite" as const, lang: "fr" })), "fr", "nosite").length, 3);
check("suggest: unknown tag in stored settings reads as any", templateOf({ ...s, tpl1For: "oops" }, "tpl1").for, "any");

// ---- filling: placeholders, {{website}}, French spacing ----
const vars = (website?: string) => templateVars({ businessName: "Bella Vista", website }, s);
check("fill: {{website}} is the own domain", fillTemplate("site {{website}}.", vars("https://www.bellavista.fr/menu")), "site bellavista.fr.");
check("fill: {{website}} is empty for a facebook page (default used)", fillTemplate("({{website|votre site}})", vars("facebook.com/bella")), "(votre site)");
check("fill: empty value leaves no space before the comma", fillTemplate("Hello {{contact}},", vars()), "Hello,");
check("fill: empty value in the middle of a line", fillTemplate("in {{city}} today", vars()), "in today");
check("fill: two empty values before a comma", fillTemplate("Hello {{contact}} {{city}}, how are you", vars()), "Hello, how are you");
const rich = templateVars({ businessName: "Bella Vista", reviews: "331", rating: "4.6", observation: "votre menu en ligne est une photo floue" }, s);
check("fill: {{reviews}} and {{rating}}", fillTemplate("Avec {{reviews}} avis ({{rating}}★)", rich), "Avec 331 avis (4.6★)");
check("fill: {{reviews|beaucoup d'}} fallback", fillTemplate("Avec {{reviews|beaucoup d'}} avis", vars()), "Avec beaucoup d' avis");
check("text needed: a missing {{observation}} never uses its fallback", fillForLead("Sujet", "J'ai vu que {{observation|votre site est lent}}. Bonjour ?", vars()), { subject: "Sujet", body: "J'ai vu que [OBSERVATION]. Bonjour ?", missing: ["observation"] });
check("text needed: with an observation the draft is complete", fillForLead("Sujet", "J'ai vu que {{observation}}.", rich).missing, []);
// capitals from placeholder values are theirs; capitals in my own text are not
const caps = (e: string[]) => e.filter((x) => x.startsWith("ALL CAPS"));
const chiraz = templateVars({ businessName: "CAFÉ DE CHIRAZ", city: "PARIS" }, s);
const body60 = "Bonjour, " + "je vous écris au sujet de votre site et de vos clients en ligne. ".repeat(6) + "Cela vous intéresse ?";
check("caps: a business name in capitals through {{business}} is fine", caps(validateDraft("Une idée pour CAFÉ DE CHIRAZ à PARIS", body60, "fr", "", capsAllowed(chiraz))), []);
check("caps: capitals in my own template text are still refused", caps(validateDraft("Une idée GRATUITE pour vous", body60, "fr", "", capsAllowed(chiraz))).length, 1);
check("fill: the template's own French space before ! stays after an empty value", [fillTemplate("Bonjour {{contact}} !", vars()), fillTemplate("Bonjour {{contact}} !", vars())], ["Bonjour !", "Bonjour !"]);
check("fill: French spaces before ? and : are kept", fillTemplate("Cela vous intéresse ?\nde tout : le design", vars()), "Cela vous intéresse ?\nde tout : le design");

// ---- every default template passes the draft rules, in its own language, with and without a website ----
for (const id of TEMPLATE_IDS) {
  const x = templateOf(s, id);
  for (const website of ["", "bellavista.fr"]) {
    const v = templateVars({ businessName: "Bella Vista", website }, s);
    const subject = fillTemplate(x.subject, v), body = fillTemplate(x.body, v);
    check(`default ${id} (${x.for}) passes the rules${website ? " with a website" : ""}`, validateDraft(subject, body, detectLang(body), "Bella Vista"), []);
  }
}

// ---- the English side: a translation counts only for the text it was made from ----
const mail = { language: "fr", subject: "Bonjour", body: "Texte" };
const key = textKey(mail.subject, mail.body);
check("english: an English mail needs no translation", englishOf({ ...mail, language: "en" }).kind, "same");
const pend = (m: Parameters<typeof englishOf>[0]) => { const e = englishOf(m); return e.kind === "pending" ? { queued: e.queued, retryIn: e.retryIn ?? null, error: e.error ?? null, rejected: !!e.rejected } : e.kind; };
const now = Date.now();
check("english: a new draft is queued for the worker right away", pend({ ...mail, status: "ready", enNeeded: true, enRetryAt: new Date(now - 1000).toISOString() }), { queued: true, retryIn: 0, error: null, rejected: false });
check("english: a draft from before translations existed is queued", pend({ ...mail, status: "ready" }), { queued: true, retryIn: null, error: null, rejected: false });
check("english: translation of this exact text", englishOf({ ...mail, subjectEn: "Hello", bodyEn: "Text", enFor: key }), { kind: "ready", subject: "Hello", body: "Text" });
check("english: translation of an older text is not shown", englishOf({ ...mail, subjectEn: "Hello", bodyEn: "Text", enFor: textKey("Bonjour", "Ancien texte") }).kind, "pending");
check("english: a failed try shows its reason and when the worker retries", pend({ ...mail, status: "ready", enNeeded: true, enError: "AI HTTP 500", enRetryAt: new Date(now + 15 * 60000 - 500).toISOString() }), { queued: true, retryIn: 15, error: "AI HTTP 500", rejected: false });
check("english: after the last failed try only the button is left", pend({ ...mail, status: "ready", enNeeded: true, enError: "AI HTTP 500", enRetryAt: null }), { queued: false, retryIn: null, error: "AI HTTP 500", rejected: false });
check("english: a rejected mail is never queued", pend({ ...mail, status: "rejected", enNeeded: false, enRetryAt: null }), { queued: false, retryIn: null, error: null, rejected: true });
check("english: drafts from before the fingerprint keep their translation", englishOf({ ...mail, bodyEn: "Text" }).kind, "ready");
check("english: the fingerprint changes with the subject too", textKey("a", "b") === textKey("a2", "b"), false);

console.log(failed ? `\n${failed} FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
