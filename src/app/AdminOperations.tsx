"use client";

import { useEffect, useState } from "react";
import { backendConfigured, getSupabase } from "./lib/supabase";

type Row = Record<string, unknown>;

export function AdminOperations() {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("reviewer");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [withdrawals, setWithdrawals] = useState<Row[]>([]);
  const [risks, setRisks] = useState<Row[]>([]);
  const [payments, setPayments] = useState<Row[]>([]);
  const [audit, setAudit] = useState<Row[]>([]);
  const [releases, setReleases] = useState<Row[]>([]);
  const [releaseName, setReleaseName] = useState("NaijaVSR");
  const [releaseVersion, setReleaseVersion] = useState("");
  const [staffRequests, setStaffRequests] = useState<Row[]>([]);
  const [message, setMessage] = useState("");

  async function refresh() {
    const supabase = getSupabase();
    if (!supabase) return;
    const [withdrawalResult, riskResult, paymentResult, auditResult, releaseResult, staffRequestResult] = await Promise.all([
      supabase.from("withdrawal_requests").select("*").in("status", ["requested", "processing"]).order("requested_at"),
      supabase.from("risk_flags").select("*").eq("status", "open").order("score", { ascending: false }),
      supabase.from("payments").select("id,submission_id,amount,currency,status,created_at").in("status", ["eligible", "processing", "failed"]).order("created_at"),
      supabase.from("audit_events").select("id,action,entity_type,entity_id,created_at").order("created_at", { ascending: false }).limit(25),
      supabase.from("dataset_releases").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("user_id,display_name,participant_id,created_at").eq("staff_request_status", "pending").eq("role", "participant").order("created_at"),
    ]);
    setWithdrawals(withdrawalResult.data || []);
    setRisks(riskResult.data || []);
    setPayments(paymentResult.data || []);
    setAudit(auditResult.data || []);
    setReleases(releaseResult.data || []);
    setStaffRequests(staffRequestResult.data || []);
  }

  useEffect(() => { refresh(); }, []);
  if (!backendConfigured) return <div className="notice"><p>Connect Supabase to activate administrative operations.</p></div>;

  async function assignRole() {
    const supabase = getSupabase();
    const { error } = await supabase!.rpc("assign_role", { p_user_id: userId, p_role: role });
    setMessage(error ? error.message : "Role assigned.");
  }

  async function approveStaffRequest(id: string, approvedRole: "reviewer" | "admin") {
    const supabase = getSupabase();
    const { error } = await supabase!.rpc("assign_role", { p_user_id: id, p_role: approvedRole });
    setMessage(error ? error.message : `Approved as ${approvedRole}.`);
    refresh();
  }

  async function dismissStaffRequest(id: string) {
    const supabase = getSupabase();
    const { error } = await supabase!.rpc("dismiss_staff_request", { p_user_id: id });
    setMessage(error ? error.message : "Request dismissed.");
    refresh();
  }

  async function createPolicy() {
    const supabase = getSupabase();
    const { error } = await supabase!.from("compensation_policies").insert({
      name: `Policy ${new Date().toISOString()}`,
      amount: Number(amount),
      currency,
      minimum_accepted_recordings: 69,
      partial_payment_allowed: false,
      effective_at: new Date().toISOString(),
    });
    setMessage(error ? error.message : "Compensation policy created.");
  }

  async function completeWithdrawal(id: string, submissionId: string) {
    const supabase = getSupabase();
    const now = new Date().toISOString();
    const { error } = await supabase!.from("withdrawal_requests").update({
      status: "completed", completed_at: now, response: "Withdrawal processed by administrator.",
    }).eq("id", id);
    if (!error && submissionId) await supabase!.from("submissions").update({ status: "withdrawn" }).eq("id", submissionId);
    setMessage(error ? error.message : "Withdrawal completed.");
    refresh();
  }

  async function resolveRisk(id: string, status: "dismissed" | "confirmed") {
    const supabase = getSupabase();
    const { error } = await supabase!.from("risk_flags").update({ status, resolved_at: new Date().toISOString() }).eq("id", id);
    setMessage(error ? error.message : "Risk flag resolved.");
    refresh();
  }

  async function createRelease() {
    const supabase = getSupabase();
    const { error } = await supabase!.from("dataset_releases").insert({
      name: releaseName, version: releaseVersion, status: "draft", license: "Research license pending approval",
    });
    setMessage(error ? error.message : "Dataset release draft created.");
    refresh();
  }

  async function advanceRelease(id: string, status: string) {
    const supabase = getSupabase();
    const values: Record<string, unknown> = { status };
    if (status === "published") values.published_at = new Date().toISOString();
    const { error } = await supabase!.from("dataset_releases").update(values).eq("id", id);
    setMessage(error ? error.message : `Release moved to ${status}.`);
    refresh();
  }

  return <section className="admin-operations">
    <div className="section-head"><div><div className="eyebrow">Administrator controls</div><h2>Operations and governance</h2></div></div>
    {message && <p className="auth-message">{message}</p>}
    <div className="ops-grid">
      <div className="ops-card"><h3>Pending staff requests</h3>{staffRequests.length ? staffRequests.map((row) => <div className="ops-row" key={String(row.user_id)}><span>{String(row.display_name || "Unnamed")} · {String(row.participant_id)}</span><button onClick={() => approveStaffRequest(String(row.user_id), "reviewer")}>Make reviewer</button><button onClick={() => approveStaffRequest(String(row.user_id), "admin")}>Make admin</button><button onClick={() => dismissStaffRequest(String(row.user_id))}>Dismiss</button></div>) : <p>No pending requests.</p>}</div>
      <div className="ops-card"><h3>Assign role</h3><input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="Supabase user UUID" /><select value={role} onChange={(event) => setRole(event.target.value)}><option>reviewer</option><option>admin</option><option>participant</option></select><button className="primary" onClick={assignRole}>Assign role</button></div>
      <div className="ops-card"><h3>Compensation policy</h3><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Full-session amount" /><select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>NGN</option><option>GHS</option><option>USD</option><option>GBP</option><option>EUR</option></select><button className="primary" onClick={createPolicy}>Create policy</button></div>
      <div className="ops-card"><h3>Dataset release</h3><input value={releaseName} onChange={(event) => setReleaseName(event.target.value)} placeholder="Dataset name" /><input value={releaseVersion} onChange={(event) => setReleaseVersion(event.target.value)} placeholder="Version, e.g. 1.0" /><button className="primary" disabled={!releaseVersion} onClick={createRelease}>Create release draft</button></div>
    </div>
    <div className="ops-grid">
      <div className="ops-card"><h3>Withdrawal requests</h3>{withdrawals.length ? withdrawals.map((row) => <div className="ops-row" key={String(row.id)}><span>{String(row.submission_id || "Account request")}</span><button onClick={() => completeWithdrawal(String(row.id), String(row.submission_id || ""))}>Complete</button></div>) : <p>No open requests.</p>}</div>
      <div className="ops-card"><h3>Risk flags</h3>{risks.length ? risks.map((row) => <div className="ops-row" key={String(row.id)}><span>{String(row.flag_type)} · {String(row.score)}</span><button onClick={() => resolveRisk(String(row.id), "dismissed")}>Dismiss</button><button onClick={() => resolveRisk(String(row.id), "confirmed")}>Confirm</button></div>) : <p>No open flags.</p>}</div>
      <div className="ops-card"><h3>Payment queue</h3>{payments.length ? payments.map((row) => <div className="ops-row" key={String(row.id)}><span>{String(row.amount)} {String(row.currency)} · {String(row.status)}</span></div>) : <p>No payments require action.</p>}</div>
      <div className="ops-card"><h3>Recent audit events</h3>{audit.map((row) => <div className="ops-row" key={String(row.id)}><span>{String(row.action)} · {String(row.entity_type)}</span><small>{new Date(String(row.created_at)).toLocaleString()}</small></div>)}</div>
      <div className="ops-card"><h3>Release pipeline</h3>{releases.length ? releases.map((row) => <div className="ops-row" key={String(row.id)}><span>{String(row.name)} {String(row.version)} · {String(row.status)}</span>{row.status === "draft" && <button onClick={() => advanceRelease(String(row.id), "privacy_review")}>Privacy review</button>}{row.status === "privacy_review" && <button onClick={() => advanceRelease(String(row.id), "approved")}>Approve</button>}{row.status === "approved" && <button onClick={() => advanceRelease(String(row.id), "published")}>Publish</button>}</div>) : <p>No release drafts.</p>}</div>
    </div>
  </section>;
}
