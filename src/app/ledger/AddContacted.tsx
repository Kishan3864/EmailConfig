"use client";
import { useState, useTransition } from "react";
import { addContactedAction } from "../actions";

export function AddContacted() {
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  return (
    <form className="card space-y-3" action={(fd) => start(async () => setMsg(await addContactedAction(fd)))}>
      <h2 className="h2">Add already-contacted addresses</h2>
      <textarea name="emails" className="input" rows={4} placeholder="Emails you already contacted yourself (spaces, commas or new lines)" required />
      <input name="note" className="input" placeholder="Note (optional)" />
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Add to ledger"}</button>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
    </form>
  );
}
