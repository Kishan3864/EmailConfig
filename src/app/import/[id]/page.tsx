import Link from "next/link";
import { notFound } from "next/navigation";
import { C, rows, type ImportRow, type LeadList } from "@/lib/fsdb";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { fmt } from "@/lib/time";
import type { IconName } from "@/components/icons";
import { Info } from "@/components/Info";
import { ToastOnMount } from "@/components/toast";
import { Badge, Callout, EmptyState, NextStep, PageHeader, Section, Stat, Steps, type StepState, type Tone } from "@/components/ui";
import { ConfirmImport } from "./ConfirmImport";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Import preview", "Import preview") };
}

// The importer stores its reasons as short English codes; show them as plain text in the UI language (the original text stays in the tooltip).
const REASON: Record<string, { hi: string; en: string }> = {
  "no email": { hi: "Email nahi hai", en: "No email" },
  "invalid syntax": { hi: "Email ka format galat hai", en: "Invalid email format" },
  suppressed: { hi: "Block list mein hai", en: "On the Block list" },
  "already contacted (in Firebase ledger)": { hi: "Pehle contact ho chuka hai (Ledger mein hai)", en: "Already contacted (in the Ledger)" },
  "already imported in an earlier list": { hi: "Pichhli kisi list mein pehle se hai", en: "Already in an earlier list" },
  "marked as chain": { hi: "File mein chain mark kiya hai", en: "Marked as a chain in the file" },
  "chain (3+ rows share this domain/email)": { hi: "Chain lagta hai: 3+ rows mein same domain/email", en: "Looks like a chain: 3+ rows share this domain/email" },
  "business already contacted (in Firebase ledger)": { hi: "Is business se pehle contact ho chuka hai (Ledger)", en: "This business was already contacted (Ledger)" },
  "business already imported in an earlier list": { hi: "Ye business pichhli list mein pehle se hai", en: "This business is already in an earlier list" },
  "no MX record": { hi: "Domain ka MX record nahi, mail nahi pahunchegi", en: "The domain has no MX record, mail would not arrive" },
  "looks like a private person's address": { hi: "Kisi insaan ka personal address lagta hai", en: "Looks like a person's private address" },
  "already imported (race)": { hi: "Kisi doosri list se pehle hi import ho chuka hai", en: "Already imported from another list" },
  failed: { hi: "Add nahi ho paya", en: "Could not be added" },
};
function wajah(reason: string, t: T) {
  const role = reason.match(/^role address \((.+)\)$/);
  if (role) return t(`Role address hai (${role[1]}), kisi insaan ka nahi`, `Role address (${role[1]}), not a person's`);
  const dup = reason.match(/^duplicate business \(kept (.+)\)$/);
  if (dup) return t(`Same business ka doosra address (${dup[1]} rakha)`, `Another address of the same business (kept ${dup[1]})`);
  const r = REASON[reason];
  return r ? t(r.hi, r.en) : reason;
}

/**
 * Business cell: the name, then the facts from the file in small type (contact · city · type, then what they do and the
 * true fact, cut to one line; the full text is in the tooltip). Besides their own website title / description, these are
 * the only facts the AI may use about the business.
 */
function Details({ r, t }: { r: ImportRow; t: T }) {
  const meta = ([[r.contactName, t("Contact ka naam", "Contact name")], [r.city, t("Shehar", "City")], [r.category, t("Business ka type", "Type of business")]] as const)
    .filter(([v]) => v);
  // one line each, at most 280px; on the phone cards they stay right-aligned like the other values
  const small = "max-w-[280px] truncate text-xs max-md:ml-auto";
  const line = (label: string, v?: string | null) => v && (
    <div className={`${small} text-slate-400`} title={`${label}: ${v}`}><span className="text-slate-500">{label}:</span> {v}</div>
  );
  return (
    <div className="min-w-0">
      {r.businessName && <div>{r.businessName}</div>}
      {meta.length > 0 && (
        <div className={`${small} text-slate-500`} title={meta.map(([v, l]) => `${l}: ${v}`).join("\n")}>
          {meta.map(([v], i) => <span key={i}>{i > 0 && <span className="text-slate-300"> · </span>}{v}</span>)}
        </div>
      )}
      {line(t("Kya karta hai", "What they do"), r.about)}
      {line(t("Sach baat", "True fact"), r.note)}
    </div>
  );
}

/** Phone version of a Stat tile: three fit in one row. */
function MiniStat({ href, label, value, dot, info, on }: { href: string; label: string; value: number; dot: string; info: string; on: boolean }) {
  return (
    <Link href={href} className={`card block !p-3 transition active:scale-[.98] ${on ? "!border-indigo-300 ring-2 ring-indigo-500/15" : ""}`}>
      <div className="flex items-center gap-1.5 text-2xs font-semibold text-slate-500">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 truncate">{label}</span>
        <Info text={info} title={label} size={12} />
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>
    </Link>
  );
}

export default async function ImportPreview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ f?: string }> }) {
  const { t } = await getT();
  const id = (await params).id;
  const { f } = await searchParams;
  const ld = await C.lists.doc(id).get();
  if (!ld.exists) notFound();
  const list = { id, ...ld.data() } as LeadList;
  const c = list.counts || {};
  const q = f ? C.lists.doc(id).collection("rows").where("outcome", "==", f) : C.lists.doc(id).collection("rows");
  const items = rows<ImportRow>(await q.limit(1000).get()).sort((a, b) => a.rowNo - b.rowNo);

  const send = c.send || 0, review = c.review || 0, skip = c.skip || 0;
  const done = !!list.confirmed;
  const nothing = send + review === 0;
  // after confirm the 'send' rows are Ready leads, so the page stops saying "Bhejenge" / "Will send" for them
  const sendLabel = done ? "Ready" : t("Bhejenge", "Will send");
  const tabs = [{ f: "", label: t("Sab", "All"), n: send + review + skip }, { f: "send", label: sendLabel, n: send }, { f: "review", label: "Review", n: review }, { f: "skip", label: "Skip", n: skip }];
  const tabBar = (
    <div className="seg">
      {tabs.map((tab) => (
        <Link key={tab.label} href={tab.f ? `/import/${id}?f=${tab.f}` : `/import/${id}`} scroll={false} className={`seg-item ${(f || "") === tab.f ? "seg-item-on" : ""}`}>
          {tab.label}<span className="tabular-nums text-slate-400">{tab.n}</span>
        </Link>
      ))}
    </div>
  );
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const added = [send && `${send} Ready`, review && t(`${review} 'Review chahiye'`, `${review} 'Needs review'`)].filter(Boolean).join(t(" aur ", " and "));
  const steps = (short: boolean): { label: string; state: StepState }[] => [
    { label: short ? t("File do", "Add file") : t("File ya text do", "Add file or text"), state: "done" },
    { label: short ? t("Check karo", "Check") : t("Match / check karo", "Map / check"), state: "done" },
    { label: short ? "Confirm" : "Preview & confirm", state: done ? "done" : "current" },
  ];
  // list.counts are frozen at confirm; what happened to the leads after that is only on the Contacts page
  const snapshot = done
    ? t("\nYe ginti confirm ke waqt ki hai. Leads ka abhi ka status Contacts mein dikhta hai.", "\nThese counts are from the time of confirming. The leads' current status is shown in Contacts.")
    : "";
  const stats: { f: string; label: string; short: string; value: number; tone: Tone; icon: IconName; dot: string; sub: string; info: string }[] = [
    {
      f: "send", label: done ? t("Ready hue", "Became Ready") : t("Bhejenge", "Will send"), short: sendLabel, value: send, tone: "emerald", icon: "send", dot: "bg-emerald-500",
      sub: done ? t("Confirm par Ready bane", "Made Ready on confirm") : t("Confirm par Ready banenge", "Made Ready when you confirm"),
      info: t(
        "Ye addresses saare checks pass kar chuke hain: sahi format, MX record, role address nahi, Ledger aur Block list mein nahi. Confirm par ye 'Ready' status ke saath Contacts mein jaate hain aur campaign mein use hote hain.",
        "These addresses passed every check: valid format, MX record, not a role address, not in the Ledger or Block list. On confirm they go to Contacts with the 'Ready' status and are used in campaigns.",
      ) + snapshot,
    },
    {
      f: "review", label: t("Review chahiye", "Needs review"), short: "Review", value: review, tone: "amber", icon: "eye", dot: "bg-amber-500",
      sub: done ? t("Review status mein add hue", "Added as 'Needs review'") : t("Aapke approval ke baad hi mail", "Mailed only after you approve"),
      info: t(
        "Ye kisi insaan ka personal address lagta hai (jaise naam.surname@ ya gmail). Confirm par ye 'Review chahiye' status mein add hote hain; Contacts mein khud dekh ke approve ya reject karo.",
        "These look like a person's private address (like name.surname@ or gmail). On confirm they are added with the 'Needs review' status; check them yourself in Contacts and approve or reject them.",
      ) + snapshot,
    },
    {
      f: "skip", label: done ? t("Skip hue", "Skipped") : t("Skip honge", "Will be skipped"), short: "Skip", value: skip, tone: "slate", icon: "x-circle", dot: "bg-slate-400",
      sub: done ? t("Add nahi hue", "Not added") : t("Kabhi add nahi honge", "Will never be added"),
      info: t(
        `Ye rows add nahi ${done ? "hui" : "hongi"}: email nahi ya galat, MX record nahi, role address, chain, duplicate business, Block list, ya pehle contact ho chuka. Har row ki wajah table mein hai.`,
        `These rows ${done ? "were not" : "will not be"} added: missing or invalid email, no MX record, role address, chain, duplicate business, Block list, or already contacted. The table shows the reason for each row.`,
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={`${done ? "List" : "Preview"}: ${list.name}`}
        back={{ href: "/import", label: "Import" }}
        sub={`${t("Kahan se mile", "Source")}: ${list.sourceNote} · ${fmt(list.createdAt)}`}
        info={done
          ? t(
            "Is list ki har row ka import result: Ready (saare checks pass, Ready status mein add hua), Review ('Review chahiye' status mein add hua) ya Skip (add nahi hua).\nTiles ya tabs se filter karo, aur 'Wajah' mein dekho kyun.\nYe ginti import ke waqt ki hai. Leads ka abhi ka status Contacts mein dikhta hai.",
            "The import result of every row in this list: Ready (passed all checks, added with the Ready status), Review (added with the 'Needs review' status) or Skip (not added).\nFilter with the tiles or tabs, and see why under 'Reason'.\nThese counts are from the time of the import. The leads' current status is shown in Contacts.",
          )
          : t(
            "Yahan dikhta hai ki file ki har row ka kya hoga: Bhejenge (saare checks pass), Review chahiye (aap khud dekhoge) ya Skip (add nahi hoga).\nTiles ya tabs se filter karo, aur 'Wajah' mein dekho kyun.\nConfirm karne par hi leads Contacts mein add hote hain; skip wale kabhi add nahi hote.",
            "This shows what will happen to each row of the file: Will send (passed all checks), Needs review (you check it yourself) or Skip (not added).\nFilter with the tiles or tabs, and see why under 'Reason'.\nLeads are added to Contacts only when you confirm; skipped rows are never added.",
          )}
        actions={done ? <Badge v="done" label={t("Import ho chuka", "Imported")} tone="emerald" /> : <Badge v="draft" label={t("Confirm baaki hai", "Not confirmed yet")} tone="amber" />}
      />

      <div className="space-y-4">
        <div>
          <div className="sm:hidden"><Steps steps={steps(true)} /></div>
          <div className="hidden sm:block"><Steps steps={steps(false)} /></div>
        </div>

        {done && (
          <Callout tone="success" title={t("Ye list import ho chuki hai", "This list has been imported")}>
            {added ? t(`Contacts mein add hue: ${added}.`, `Added to Contacts: ${added}.`) : t("Is list se koi lead add nahi hua.", "No leads were added from this list.")}
            {skip ? t(` ${plural(skip, "row", "rows")} skip hui.`, ` ${plural(skip, "row was", "rows were")} skipped.`) : ""}
          </Callout>
        )}
        {!done && nothing && (
          <>
            <Callout tone="warn" title={t("Is list mein bhejne layak koi address nahi", "This list has no address that can be mailed")}>
              {t("Saari rows skip hongi, isliye confirm karne se kuch add nahi hoga. Wajah neeche table mein dekho.", "Every row will be skipped, so confirming adds nothing. See the reasons in the table below.")}
            </Callout>
            <ToastOnMount kind="warning" title={t("Koi address bhejne layak nahi", "No address can be mailed")}
              text={t("Is list ki saari rows skip hongi. Doosri file import karke dekho.", "Every row of this list will be skipped. Try importing another file.")} once={`import-empty:${id}`} />
          </>
        )}

        <div>
          <div className="grid grid-cols-3 gap-2 sm:hidden">
            {stats.map((s) => <MiniStat key={s.f} href={`/import/${id}?f=${s.f}`} label={s.short} value={s.value} dot={s.dot} info={s.info} on={f === s.f} />)}
          </div>
          <div className="hidden gap-3 sm:grid sm:grid-cols-3">
            {stats.map((s) => <Stat key={s.f} href={`/import/${id}?f=${s.f}`} label={s.label} value={s.value} tone={s.tone} icon={s.icon} sub={s.sub} info={s.info} />)}
          </div>
        </div>

        {done ? (
          // counts are from confirm time and the leads may have moved on since, so this is worded as history
          review > 0 ? (
            <NextStep href="/contacts?status=needs_review" cta={t("Review wale dekho", "See leads to review")}
              text={t(
                <>Import ke waqt {plural(review, "lead", "leads")} &apos;Review chahiye&apos; mein {review === 1 ? "gaya tha" : "gaye the"}. Agar abhi tak approve ya reject nahi kiya, to Contacts mein karo, phir campaign banao.</>,
                <>At import time, {plural(review, "lead", "leads")} went to &apos;Needs review&apos;. If you have not approved or rejected {review === 1 ? "it" : "them"} yet, do it in Contacts, then create a campaign.</>,
              )} />
          ) : send > 0 ? (
            <NextStep href="/campaigns" cta={t("Campaigns kholo", "Open Campaigns")}
              text={t(
                <>Import ke waqt {plural(send, "lead", "leads")} Ready {send === 1 ? "bana tha" : "bane the"}. Agar is list se abhi tak campaign nahi banaya, to Campaigns page pe banao: pehle 5 sample mails banti hain, unhe approve karte hi campaign shuru hota hai.</>,
                <>At import time, {plural(send, "lead was", "leads were")} made Ready. If you have not created a campaign from this list yet, create one on the Campaigns page: 5 sample mails are made first, and the campaign starts as soon as you approve them.</>,
              )} />
          ) : (
            <NextStep tone="amber" href="/import" cta={t("Nayi list import karo", "Import a new list")}
              text={t("Is list se koi lead add nahi hua. Doosri file import karo.", "No leads were added from this list. Import another file.")} />
          )
        ) : nothing ? (
          <NextStep tone="amber" href="/import" cta={t("Doosri file import karo", "Import another file")}
            text={t("Is list se kuch add nahi hoga. Doosri file try karo, ya confirm karke is list ko band kar do.", "Nothing will be added from this list. Try another file, or confirm to close this list.")}>
            <ConfirmImport listId={id} review={review} expected={send + review} className="btn" />
          </NextStep>
        ) : (
          <NextStep text={t(
            <>Rows check karo, phir confirm karo. Confirm karne par sirf <b>&apos;Bhejenge&apos;</b> aur <b>&apos;Review&apos;</b> wale leads add honge; skip wale nahi.</>,
            <>Check the rows, then confirm. Confirming adds only the <b>&apos;Will send&apos;</b> and <b>&apos;Review&apos;</b> leads; skipped rows are not added.</>,
          )}>
            <ConfirmImport listId={id} review={review} expected={send + review} />
          </NextStep>
        )}

        <Section flush icon="list" title={t("Har row ka result", "Result for each row")}
          sub={t(
            `${plural(items.length, "row", "rows")} dikh rahi ${items.length === 1 ? "hai" : "hain"}${items.length >= 1000 ? " (sirf pehli 1000)" : ""}`,
            `Showing ${plural(items.length, "row", "rows")}${items.length >= 1000 ? " (first 1000 only)" : ""}`,
          )}
          info={(done
            ? t(
              "File ki har row aur uska import result. Ready = Ready status mein add hua, Review = 'Review chahiye' mein add hua, Skip = add nahi hua.\nTabs se filter karo. Ek baar mein max 1000 rows dikhti hain.",
              "Every row of the file and its import result. Ready = added with the Ready status, Review = added as 'Needs review', Skip = not added.\nFilter with the tabs. At most 1000 rows are shown at a time.",
            )
            : t(
              "File ki har row aur uska result. Bhejenge = add hoke campaign mein jayega, Review = aapke approval ke baad, Skip = add nahi hoga.\nTabs se filter karo. Ek baar mein max 1000 rows dikhti hain.",
              "Every row of the file and its result. Will send = added and goes into a campaign, Review = only after your approval, Skip = not added.\nFilter with the tabs. At most 1000 rows are shown at a time.",
            )) + t(
            "\nBusiness ke neeche file se aayi baatein dikhti hain: contact, shehar, type, kya karta hai aur sach baat. AI business ke baare mein sirf yahi (aur unki website ka apna title/description) use karta hai.",
            "\nUnder the business name you see the facts from the file: contact, city, type, what they do and the true fact. About the business, the AI uses only these (and their website's own title and description).",
          )}
          actions={<div className="max-sm:hidden">{tabBar}</div>}>
          {/* phones: the tabs get a row of their own; next to the title they squeeze it to one word per line */}
          <div className="border-b border-slate-100 px-4 py-2.5 sm:hidden">{tabBar}</div>
          {items.length ? (
            <div className="overflow-x-auto">
              <table className="tbl tbl-stack">
                <thead><tr><th className="w-12">#</th><th>Result</th><th>{t("Wajah", "Reason")}</th><th>Email</th><th>Business</th><th>Website</th><th>{t("Desh", "Country")}</th></tr></thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Row" className="tabular-nums text-slate-400">{r.rowNo}</td>
                      <td data-label="Result"><Badge v={r.outcome} label={r.outcome === "send" ? sendLabel : undefined} /></td>
                      <td data-label={t("Wajah", "Reason")} className="text-xs text-slate-500" title={r.reason || undefined}>{r.reason ? wajah(r.reason, t) : r.outcome === "send" ? t("Saare checks pass", "Passed all checks") : null}</td>
                      {/* only the stacked phone cards may break an address anywhere; in the desktop table it would squeeze the column */}
                      <td data-label="Email" className="font-medium text-slate-900 max-md:[overflow-wrap:anywhere]">{r.email}</td>
                      <td data-label="Business">{(r.businessName || r.contactName || r.city || r.category || r.about || r.note) && <Details r={r} t={t} />}</td>
                      <td data-label="Website">{r.website && <span className="block min-w-0 max-w-[220px] truncate" title={r.website}>{r.website}</span>}</td>
                      <td data-label={t("Desh", "Country")}>{r.country}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : f ? (
            <EmptyState icon="filter" title={t("Is filter mein koi row nahi", "No rows in this filter")} text={t("Doosra tab chuno ya saari rows dekho.", "Choose another tab or see all rows.")} href={`/import/${id}`} cta={t("Saari rows dekho", "See all rows")} />
          ) : (
            <EmptyState icon="file" title={t("Is list mein koi row nahi", "This list has no rows")} text={t("Nayi file import karke dobara try karo.", "Import a new file and try again.")} href="/import" cta={t("Nayi file import karo", "Import a new file")} />
          )}
        </Section>
      </div>
    </div>
  );
}
