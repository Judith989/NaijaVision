"use client";

import { useEffect, useState } from "react";
import { backendConfigured, getSupabase } from "./lib/supabase";

type Row = Record<string, unknown>;

export function AdminOperations() {
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
  const [staffMembers, setStaffMembers] = useState<Row[]>([]);
  const [pendingSubmissions, setPendingSubmissions] = useState<Row[]>([]);
  const [reviewerAssignments, setReviewerAssignments] = useState<Record<string, string>>({});
  const [activePolicy, setActivePolicy] = useState<Row | null>(null);
  const [participantQuery, setParticipantQuery] = useState("");
  const [participants, setParticipants] = useState<Row[]>([]);
  const [message, setMessage] = useState("");

  async function refresh() {
    const supabase = getSupabase();
    if (!supabase) return;
    const [withdrawalResult, riskResult, paymentResult, auditResult, releaseResult, staffRequestResult, staffMemberResult, submissionResult, policyResult] = await Promise.all([
      supabase.from("withdrawal_requests").select("*").in("status", ["requested", "processing"]).order("requested_at"),
      supabase.from("risk_flags").select("*").eq("status", "open").order("score", { ascending: false }),
      supabase.from("payments").select("id,submission_id,amount,currency,status,created_at").in("status", ["eligible", "processing", "failed"]).order("created_at"),
      supabase.from("audit_events").select("id,action,entity_type,entity_id,created_at").order("created_at", { ascending: false }).limit(25),
      supabase.from("dataset_releases").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("user_id,display_name,participant_id,created_at").eq("staff_request_status", "pending").eq("role", "participant").order("created_at"),
      supabase.from("profiles").select("user_id,display_name,participant_id,role,account_status,updated_at").in("role", ["reviewer", "admin"]).order("role").order("display_name"),
      supabase.from("submissions").select("id,participant_id,status,expected_recordings,assigned_reviewer_id,created_at").in("status", ["automated_qc", "awaiting_review", "resubmitted"]).order("created_at"),
      supabase.from("compensation_policies").select("id,amount,currency,pricing_basis,effective_at").is("retired_at", null).order("effective_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setWithdrawals(withdrawalResult.data || []);
    setRisks(riskResult.data || []);
    setPayments(paymentResult.data || []);
    setAudit(auditResult.data || []);
    setReleases(releaseResult.data || []);
    setStaffRequests(staffRequestResult.data || []);
    setStaffMembers(staffMemberResult.data || []);
    setPendingSubmissions(submissionResult.data || []);
    setActivePolicy(policyResult.data || null);
  }

  async function searchParticipants() {
    const supabase = getSupabase();
    if (!supabase) return;
    let query = supabase.from("profiles").select("user_id,display_name,participant_id,created_at").eq("role", "participant").order("created_at", { ascending: false }).limit(25);
    const term = participantQuery.trim();
    if (term) query = query.or(`display_name.ilike.%${term}%,participant_id.ilike.%${term}%`);
    const { data } = await query;
    setParticipants(data || []);
  }

  async function promoteParticipant(id: string, newRole: "reviewer" | "admin") {
    if (!window.confirm(`Grant ${newRole} access to this account?`)) return;
    const supabase = getSupabase();
    const { error } = await supabase!.rpc("set_staff_role", { p_user_id: id, p_role: newRole });
    setMessage(error ? error.message : `Promoted to ${newRole}.`);
    await Promise.all([refresh(), searchParticipants()]);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { refresh(); searchParticipants(); }, 0);
    return () => window.clearTimeout(timer);
    // The initial administrative snapshot is loaded once when the workspace opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!backendConfigured) return <div className="notice"><p>Connect Supabase to activate administrative operations.</p></div>;

  async function approveStaffRequest(id: string, approvedRole: "reviewer" | "admin") {
    if (!window.confirm(`Approve this request with ${approvedRole} access?`)) return;
    const supabase = getSupabase();
    const { error } = await supabase!.rpc("set_staff_role", { p_user_id: id, p_role: approvedRole });
    setMessage(error ? error.message : `Approved as ${approvedRole}.`);
    refresh();
  }

  async function dismissStaffRequest(id: string) {
    const supabase = getSupabase();
    const { error } = await supabase!.rpc("dismiss_staff_request", { p_user_id: id });
    setMessage(error ? error.message : "Request dismissed.");
    refresh();
  }

  async function changeStaffRole(id: string, nextRole: "participant" | "reviewer" | "admin") {
    const action = nextRole === "participant" ? "remove staff access from" : `change this account to ${nextRole} for`;
    if (!window.confirm(`Are you sure you want to ${action} this account?`)) return;
    const supabase = getSupabase();
    const { error } = await supabase!.rpc("set_staff_role", { p_user_id: id, p_role: nextRole });
    setMessage(error ? error.message : nextRole === "participant" ? "Staff access removed." : `Role changed to ${nextRole}.`);
    await Promise.all([refresh(), searchParticipants()]);
  }

  async function createPolicy() {
    const supabase = getSupabase();
    const numericAmount = Number(amount);
    if (!amount || Number.isNaN(numericAmount) || numericAmount < 0) {
      setMessage("Enter a valid participant compensation amount.");
      return;
    }
    if (!window.confirm(`Replace the active participant compensation policy with ${numericAmount} ${currency} per selected language?`)) return;
    const { error } = await supabase!.rpc("replace_compensation_policy", { p_amount: numericAmount, p_currency: currency });
    setMessage(error ? error.message : "Participant compensation policy updated.");
    if (!error) {
      setAmount("");
      refresh();
    }
  }

  async function assignSubmission(submissionId: string) {
    const reviewerId = reviewerAssignments[submissionId];
    if (!reviewerId) {
      setMessage("Select a reviewer first.");
      return;
    }
    const supabase = getSupabase();
    const { error } = await supabase!.rpc("assign_submission", { p_submission_id: submissionId, p_reviewer_id: reviewerId });
    setMessage(error ? error.message : "Submission assigned to the reviewer.");
    if (!error) refresh();
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

  return <section className="admin-operations" id="staff-management">
    <div className="section-head"><div><div className="eyebrow">Administrator controls</div><h2>Operations and governance</h2></div></div>
    {message && <p className="auth-message">{message}</p>}
    <div className="ops-grid">
      <div className="ops-card"><h3>Pending access requests</h3><p className="ops-hint">A request is not a separate staff role. Approve it as reviewer or administrator.</p>{staffRequests.length ? staffRequests.map((row) => <div className="ops-row" key={String(row.user_id)}><span>{String(row.display_name || "Unnamed")} | {String(row.participant_id)}</span><button onClick={() => approveStaffRequest(String(row.user_id), "reviewer")}>Make reviewer</button><button onClick={() => approveStaffRequest(String(row.user_id), "admin")}>Make admin</button><button onClick={() => dismissStaffRequest(String(row.user_id))}>Dismiss</button></div>) : <p>No pending requests.</p>}</div>
      <div className="ops-card"><h3>Reviewers and administrators</h3><p className="ops-hint">Reviewers assess assigned media. Administrators assign work, make final decisions, manage payments, and control releases.</p>{staffMembers.length ? staffMembers.map((row) => <div className="ops-row" key={String(row.user_id)}><span>{String(row.display_name || "Unnamed")} | {String(row.participant_id)} | {String(row.role)}</span>{row.role === "reviewer" ? <button onClick={() => changeStaffRole(String(row.user_id), "admin")}>Make admin</button> : <button onClick={() => changeStaffRole(String(row.user_id), "reviewer")}>Make reviewer</button>}<button onClick={() => changeStaffRole(String(row.user_id), "participant")}>Remove access</button></div>) : <p>No reviewer or administrator accounts found.</p>}</div>
      <div className="ops-card"><h3>Add a reviewer or administrator</h3><p className="ops-hint">Find an existing participant account, then grant the appropriate role.</p><input value={participantQuery} onChange={(event) => setParticipantQuery(event.target.value)} placeholder="Search by name or participant ID" /><button className="primary" onClick={searchParticipants}>Search</button>{participants.length ? participants.map((row) => <div className="ops-row" key={String(row.user_id)}><span>{String(row.display_name || "Unnamed")} | {String(row.participant_id)}</span><button onClick={() => promoteParticipant(String(row.user_id), "reviewer")}>Make reviewer</button><button onClick={() => promoteParticipant(String(row.user_id), "admin")}>Make admin</button></div>) : <p>No participants found.</p>}</div>
      <div className="ops-card"><h3>Participant compensation policy</h3><p className="ops-hint">This rate is multiplied by the participant&apos;s distinct selected languages. Code-switched combinations do not count as extra languages. Payment still requires administrator approval.</p>{activePolicy && <p><b>Current:</b> {String(activePolicy.amount)} {String(activePolicy.currency)} per language</p>}<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount per selected language" /><select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>NGN</option><option>GHS</option><option>USD</option><option>GBP</option><option>EUR</option></select><button className="primary" onClick={createPolicy}>Replace active policy</button></div>
      <div className="ops-card wide-ops-card"><h3>Submission assignments</h3><p className="ops-hint">Assign each pending submission to a reviewer. Reviewers only see submissions assigned to them.</p>{pendingSubmissions.length ? pendingSubmissions.map((row) => <div className="ops-row assignment-row" key={String(row.id)}><span>{String(row.participant_id)} | {String(row.status)} | {String(row.expected_recordings)} recordings</span><select value={reviewerAssignments[String(row.id)] || String(row.assigned_reviewer_id || "")} onChange={(event) => setReviewerAssignments((current) => ({ ...current, [String(row.id)]: event.target.value }))}><option value="">Select reviewer</option>{staffMembers.filter((member) => member.role === "reviewer").map((member) => <option key={String(member.user_id)} value={String(member.user_id)}>{String(member.display_name || member.participant_id)}</option>)}</select><button onClick={() => assignSubmission(String(row.id))}>{row.assigned_reviewer_id ? "Reassign" : "Assign"}</button></div>) : <p>No submissions need assignment.</p>}</div>
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
