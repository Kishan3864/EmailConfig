"use client";
import { useState, useTransition } from "react";
import { saveDraftEdit } from "../actions";

/** Edit a draft by hand. The edit is checked by the same rules as an AI draft and must be approved again. */
export function DraftEditor({ id, subject, body }: { id: string; subject: string; body: string }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  if (!open) return <button type="button" className="text-sm text-indigo-600" onClick={() => setOpen(true)}>Edit text</button>;
  return (
    <form className="space-y-2 border-t pt-3" action={(fd) => start(async () => setMsg(await saveDraftEdit(id, fd)))}>
      <input name="subject" defaultValue={subject} className="input" />
      <textarea name="body" defaultValue={body} rows={9} className="input font-sans" />
      <p className="text-xs text-slate-400">Only the body: the signature and footer are added automatically. 60–110 words, end with a question, no links.</p>
      <div className="flex gap-2 items-center">
        <button className="btn-primary" disabled={pending}>{pending ? "Checking…" : "Save edit"}</button>
        <button type="button" className="btn" onClick={() => { setOpen(false); setMsg(""); }}>Cancel</button>
        {msg && <span className={`text-sm ${msg.startsWith("Error") ? "text-red-600" : "text-slate-600"}`}>{msg}</span>}
      </div>
    </form>
  );
}
