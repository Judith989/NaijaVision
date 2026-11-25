"use client";

import { useState } from "react";
import { getSupabase } from "./lib/supabase";

type Recipient = { user_id: string; participant_id: string; display_name: string | null; task_kind: string; task_count: number; last_reminded_at: string | null; can_send: boolean };
const categories = [
  ["not_started", "Participants who have not started"],
  ["unfinished_recordings", "Participants with unfinished recordings"],
  ["participant_corrections", "Participants with returned recordings"],
  ["returned_reviews", "Reviewers with returned reviews"],
  ["pending_reviews", "Reviewers with pending reviews"],
];

export function TaskReminders() {
  const [kind, setKind] = useState("returned_reviews");
  const [rows, setRows] = useState<Recipient[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function preview() {
    const db = getSupabase();
    if (!db) return;
    setBusy(true); setMessage(""); setRows(null); setSelected([]);
    try {
      const { data, error } = await db.rpc("preview_task_reminders");
      if (error) throw error;
      const recipients = ((data || []) as Recipient[]).filter(row => row.task_kind === kind);
      setRows(recipients);
      setSelected(recipients.filter(row => row.can_send).slice(0, 200).map(row => row.user_id));
    } catch (error) { setMessage(error instanceof Error ? error.message : String((error as { message?: string }).message || "Could not load reminders. Please retry.")); }
    finally { setBusy(false); }
  }
  async function send() {
    const db = getSupabase();
    if (!db || !selected.length) return;
    setBusy(true); setMessage("");
    try {
      const { data, error } = await db.rpc("send_task_reminders", { p_task_kind: kind, p_user_ids: selected });
      if (error) throw error;
      setMessage(`${data} reminder(s) queued for email and added to dashboards. ${selected.length - Number(data)} skipped because the task changed or a reminder was already sent. Email delivery follows the existing sending limits.`);
      setRows(null); setSelected([]);
    } catch (error) {
      setMessage(String((error as { message?: string }).message || "Could not confirm sending. Refresh the preview before retrying; recent reminders are protected against duplicates."));
      setRows(null); setSelected([]);
    } finally { setBusy(false); }
  }
  return <section className="ops-card wide-ops-card" aria-labelledby="task-reminder-heading">
    <h3 id="task-reminder-heading">Pending task reminders</h3>
    <p>Send a NaijaVision email and dashboard alert to people with outstanding tasks. Only verified, active accounts with tasks older than 24 hours appear. Each person can receive one task reminder every 24 hours.</p>
    <label>Who should be reminded? <select disabled={busy} value={kind} onChange={event => { setKind(event.target.value); setRows(null); setSelected([]); setMessage(""); }}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <button className="secondary" disabled={busy} onClick={() => void preview()}>{busy ? "Working..." : "Preview recipients"}</button>
    {message && <p role="status">{message}</p>}
    {rows && <div>
      <p>{rows.length} people with matching tasks. {selected.length} selected. Up to 200 recipients per batch.</p>
      <p>The email identifies the pending task and links to the dashboard. The dashboard alert explains the next step. Private review feedback stays inside the account.</p>
      <button disabled={busy} onClick={() => setSelected(rows.filter(row => row.can_send).slice(0, 200).map(row => row.user_id))}>Select eligible recipients</button>{" "}
      <button disabled={busy} onClick={() => setSelected([])}>Clear selection</button>
      {!rows.length && <p>No matching pending tasks.</p>}
      {rows.map(row => <div className="ops-row" key={row.user_id}><label><input type="checkbox" disabled={busy || !row.can_send || (!selected.includes(row.user_id) && selected.length >= 200)} checked={selected.includes(row.user_id)} onChange={event => setSelected(current => event.target.checked ? [...current, row.user_id] : current.filter(id => id !== row.user_id))} /> {row.display_name || row.participant_id} ({row.participant_id})<small>{row.task_count} pending task(s){row.last_reminded_at ? ` | Last reminded ${new Date(row.last_reminded_at).toLocaleString()}` : " | No previous task reminder"}{!row.can_send ? " | Available again after 24 hours" : ""}</small></label></div>)}
      <button className="primary" disabled={busy || !selected.length} onClick={() => void send()}>Send {selected.length} reminder{selected.length === 1 ? "" : "s"}</button>
    </div>}
  </section>;
}
