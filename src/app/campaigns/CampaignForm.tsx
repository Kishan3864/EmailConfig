"use client";
import { useState } from "react";
import { createCampaign } from "../actions";

type L = { id: number; name: string; count: number; language: string; timezone: string };
const LANGS: Record<string, string> = { en: "English", fr: "French", de: "German", es: "Spanish", it: "Italian", nl: "Dutch", pt: "Portuguese" };
const TZS = ["Europe/Paris", "Europe/Brussels", "Europe/Zurich", "Europe/London", "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Amsterdam", "Europe/Lisbon", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Toronto", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney", "Africa/Casablanca"];

export function CampaignForm({ lists }: { lists: L[] }) {
  const [sel, setSel] = useState<L | undefined>(lists[0]);
  const [lang, setLang] = useState(lists[0]?.language || "en");
  const [tz, setTz] = useState(lists[0]?.timezone || "Europe/Paris");
  if (!lists.length) return <div className="card text-sm text-slate-500">No confirmed list with unassigned leads. Import a list first.</div>;
  return (
    <form action={createCampaign} className="card grid md:grid-cols-5 gap-3 items-end">
      <label><span className="label">Name</span><input name="name" className="input" required defaultValue={`${lists[0].name} campaign`} /></label>
      <label><span className="label">List</span>
        <select name="listId" className="input" value={sel?.id} onChange={(e) => { const l = lists.find((x) => x.id === +e.target.value)!; setSel(l); setLang(l.language); setTz(l.timezone); }}>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}
        </select>
      </label>
      <label><span className="label">Language (auto from country)</span>
        <select name="language" className="input" value={lang} onChange={(e) => setLang(e.target.value)}>{Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </label>
      <label><span className="label">Timezone</span>
        <select name="timezone" className="input" value={tz} onChange={(e) => setTz(e.target.value)}>{[...new Set([tz, ...TZS])].map((t) => <option key={t}>{t}</option>)}</select>
      </label>
      <button className="btn-primary">Create campaign</button>
    </form>
  );
}
