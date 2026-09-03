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
  const [reviewerPayments, setReviewerPayments] = useState<Row[]>([]);
  const [reviewerPolicy, setReviewerPolicy] = useState<Row | null>(null);
  const [audit, setAudit] = useState<Row[]>([]);
  const [releases, setReleases] = useState<Row[]>([]);
  const [releaseName, setReleaseName] = useState("NaijaVSR");
  const [releaseVersion, setReleaseVersion] = useState("");
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
    const [withdrawalResult, riskResult, paymentResult, reviewerPaymentResult, reviewerPolicyResult, auditResult, releaseResult, staffMemberResult, submissionResult, policyResult] = await Promise.all([
      supabase.from("withdrawal_requests").select("*").in("status", ["requested", "processing"]).order("requested_at"),
      supabase.from("risk_flags").select("*").eq("status", "open").order("score", { ascending: false }),
      supabase.from("payments").select("id,submission_id,amount,currency,status,created_at").in("status", ["eligible", "processing", "failed"]).order("created_at"),
      supabase.from("reviewer_payments").select("id,submission_id,reviewer_id,reviewed_video_count,rate_per_video,amount,currency,status,created_at").in("status", ["eligible", "processing", "failed"]).order("created_at"),
      supabase.from("reviewer_compensation_policies").select("amount_per_video,currency,effective_at").is("retired_at", null).order("effective_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("audit_events").select("id,action,entity_type,entity_id,created_at").order("created_at", { ascending: false }).limit(25),
      supabase.from("dataset_releases").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("user_id,display_name,participant_id,role,account_status,updated_at").in("role", ["reviewer", "admin"]).order("role").order("display_name"),
      supabase.from("submissions").select("id,user_id,participant_id,status,expected_recordings,assigned_reviewer_id,created_at").in("status", ["automated_qc", "awaiting_review", "resubmitted"]).order("created_at"),
      supabase.from("compensation_policies").select("id,amount,currency,pricing_basis,effective_at").is("retired_at", null).order("effective_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setWithdrawals(withdrawalResult.data || []);
    setRisks(riskResult.data || []);
    setPayments(paymentResult.data || []);
    setReviewerPayments(reviewerPaymentResult.data || []);
    setReviewerPolicy(reviewerPolicyResult.data || null);
    setAudit(auditResult.data || []);
    setReleases(releaseResult.data || []);
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

  async function changeStaffRole(id: string, nextRole: "participant" | "reviewer" | "admin") {
    const action = nextRole === "participant" ? "change this account back to participant for" : `change this account to ${nextRole} for`;
    if (!window.confirm(`Are you sure you want to ${action} this account?`)) return;
    const supabase = getSupabase();
    const { error } = await supabase!.rpc("set_staff_role", { p_user_id: id, p_role: nextRole });
    setMessage(error ? error.message : nextRole === "participant" ? "Role changed to participant." : `Role changed to ${nextRole}.`);
    await Promise.all([refresh(), searchParticipants()]);
  }

  async function createPolicy() {
    const supabase = getSupabase();
    const numericAmount = Number(amount);
    if (!amount || Number.isNaN(numericAmount) || numericAmount < 0) {
      setMessage("Enter a valid participant compensation amount.");
      return;
    }
    if (!window.confirm(`Replace the active participant compensation policy with ${numericAmount} ${currency} per completed language?`)) return;
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

  async function setReviewerPaymentStatus(id: string, status: "processing" | "paid" | "failed") {
    if (!window.confirm(`Mark this reviewer payment as ${status}?`)) return;
    const { error } = await getSupabase()!.rpc("set_reviewer_payment_status", { p_payment_id: id, p_status: status });
    setMessage(error ? error.message : `Reviewer payment marked ${status}.`);
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

  async function rejectRelease(id: string) {
    const reason = window.prompt("Why are you rejecting this dataset release?");
    if (reason === null) return;
    if (!reason.trim()) {
      setMessage("Enter a reason before rejecting the dataset release.");
      return;
    }
    if (!window.confirm("Reject this dataset release? It will not be publishable unless it is returned to draft and reviewed again.")) return;
    const supabase = getSupabase();
    const { error } = await supabase!.from("dataset_releases").update({
      status: "rejected",
      rejection_reason: reason.trim(),
    }).eq("id", id);
    setMessage(error ? error.message : "Dataset release rejected.");
    refresh();
  }

  async function returnReleaseToDraft(id: string) {
    if (!window.confirm("Return this dataset release to draft for correction?")) return;
    const supabase = getSupabase();
    const { error } = await supabase!.from("dataset_releases").update({
      status: "draft",
      rejection_reason: null,
    }).eq("id", id);
    setMessage(error ? error.message : "Dataset release returned to draft.");
    refresh();
  }

  return <section className="admin-operations" id="staff-management">
    <div className="section-head"><div><div className="eyebrow">Administrator controls</div><h2>Operations and governance</h2></div></div>
    {message && <p className="auth-message">{message}</p>}
    <div className="metric-grid"><div><span>Pending reviews</span><b>{pendingSubmissions.length}</b><small>Submissions requiring assignment or action</small></div><div><span>Reviewers</span><b>{staffMembers.filter((member) => member.role === "reviewer").length}</b><small>Active reviewer accounts</small></div><div><span>Participant payments</span><b>₦{payments.reduce((total, payment) => total + Number(payment.amount || 0), 0).toLocaleString()}</b><small>Eligible, processing, or failed</small></div><div><span>Reviewer payments</span><b>₦{reviewerPayments.reduce((total, payment) => total + Number(payment.amount || 0), 0).toLocaleString()}</b><small>Eligible, processing, or failed</small></div></div>
    <div className="ops-grid">
      <div className="ops-card"><h3>Reviewers and administrators</h3><p className="ops-hint">Reviewers assess assigned media. Administrators assign work, make final decisions, manage payments, and control releases.</p>{staffMembers.length ? staffMembers.map((row) => <div className="ops-row" key={String(row.user_id)}><span>{String(row.display_name || "Unnamed")} | {String(row.participant_id)} | {String(row.role)}</span>{row.role === "reviewer" ? <button onClick={() => changeStaffRole(String(row.user_id), "admin")}>Make admin</button> : <button onClick={() => changeStaffRole(String(row.user_id), "reviewer")}>Make reviewer</button>}<button onClick={() => changeStaffRole(String(row.user_id), "participant")}>Remove access</button></div>) : <p>No reviewer or administrator accounts found.</p>}</div>
      <div className="ops-card"><h3>Add a reviewer or administrator</h3><p className="ops-hint">Find an existing participant account, then grant the appropriate role.</p><input value={participantQuery} onChange={(event) => setParticipantQuery(event.target.value)} placeholder="Search by name or participant ID" /><button className="primary" onClick={searchParticipants}>Search</button>{participants.length ? participants.map((row) => <div className="ops-row" key={String(row.user_id)}><span>{String(row.display_name || "Unnamed")} | {String(row.participant_id)}</span><button onClick={() => promoteParticipant(String(row.user_id), "reviewer")}>Make reviewer</button><button onClick={() => promoteParticipant(String(row.user_id), "admin")}>Make admin</button></div>) : <p>No participants found.</p>}</div>
      <div className="ops-card"><h3>Participant compensation policy</h3><p className="ops-hint">This rate applies separately to each completed regular language set and each completed NaijaSafeSpeech language set. Code-switched combinations do not count as extra units. Payment still requires administrator approval.</p>{activePolicy && <p><b>Current:</b> {String(activePolicy.amount)} {String(activePolicy.currency)} per completed language set</p>}<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount per completed language set" /><select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>NGN</option><option>GHS</option><option>USD</option><option>GBP</option><option>EUR</option></select><button className="primary" onClick={createPolicy}>Replace active policy</button></div>
      <div className="ops-card"><h3>Reviewer compensation policy</h3><p className="ops-hint">Reviewers earn once for each unique video reviewed. Reviewing a replacement again does not duplicate the fee for that prompt.</p><p><b>Current:</b> {String(reviewerPolicy?.amount_per_video || 10)} {String(reviewerPolicy?.currency || "NGN")} per video</p><p>50 videos × ₦10 = ₦500</p><p>10 participants × 50 videos × ₦10 = ₦5,000</p></div>
      <div className="ops-card wide-ops-card"><h3>Submission assignments</h3><p className="ops-hint">Assign each pending submission to a different reviewer. Reviewers cannot assess their own recordings. Administrators retain access for testing and final decisions.</p>{pendingSubmissions.length ? pendingSubmissions.map((row) => <div className="ops-row assignment-row" key={String(row.id)}><span>{String(row.participant_id)} | {String(row.status)} | {String(row.expected_recordings)} recordings</span><select value={reviewerAssignments[String(row.id)] || String(row.assigned_reviewer_id || "")} onChange={(event) => setReviewerAssignments((current) => ({ ...current, [String(row.id)]: event.target.value }))}><option value="">Select reviewer</option>{staffMembers.filter((member) => member.role === "reviewer" && member.user_id !== row.user_id).map((member) => <option key={String(member.user_id)} value={String(member.user_id)}>{String(member.display_name || member.participant_id)}</option>)}</select><button onClick={() => assignSubmission(String(row.id))}>{row.assigned_reviewer_id ? "Reassign" : "Assign"}</button></div>) : <p>No submissions need assignment.</p>}</div>
      <div className="ops-card"><h3>Dataset release</h3><input value={releaseName} onChange={(event) => setReleaseName(event.target.value)} placeholder="Dataset name" /><input value={releaseVersion} onChange={(event) => setReleaseVersion(event.target.value)} placeholder="Version, e.g. 1.0" /><button className="primary" disabled={!releaseVersion} onClick={createRelease}>Create release draft</button></div>
    </div>
    <div className="ops-grid">
      <div className="ops-card"><h3>Withdrawal requests</h3>{withdrawals.length ? withdrawals.map((row) => <div className="ops-row" key={String(row.id)}><span>{String(row.submission_id || "Account request")}</span><button onClick={() => completeWithdrawal(String(row.id), String(row.submission_id || ""))}>Complete</button></div>) : <p>No open requests.</p>}</div>
      <div className="ops-card"><h3>Risk flags</h3>{risks.length ? risks.map((row) => <div className="ops-row" key={String(row.id)}><span>{String(row.flag_type)} · {String(row.score)}</span><button onClick={() => resolveRisk(String(row.id), "dismissed")}>Dismiss</button><button onClick={() => resolveRisk(String(row.id), "confirmed")}>Confirm</button></div>) : <p>No open flags.</p>}</div>
      <div className="ops-card"><h3>Participant payment queue</h3>{payments.length ? payments.map((row) => <div className="ops-row" key={String(row.id)}><span>{String(row.amount)} {String(row.currency)} · {String(row.status)}</span></div>) : <p>No participant payments require action.</p>}</div>
      <div className="ops-card"><h3>Reviewer payment queue</h3>{reviewerPayments.length ? reviewerPayments.map((row) => <div className="ops-row" key={String(row.id)}><span>{String(row.reviewed_video_count)} videos × {String(row.rate_per_video)} {String(row.currency)} = {String(row.amount)} {String(row.currency)} · {String(row.status)}</span>{row.status !== "processing" && <button onClick={() => setReviewerPaymentStatus(String(row.id), "processing")}>Processing</button>}<button onClick={() => setReviewerPaymentStatus(String(row.id), "paid")}>Paid</button><button onClick={() => setReviewerPaymentStatus(String(row.id), "failed")}>Failed</button></div>) : <p>No reviewer payments require action.</p>}</div>
      <div className="ops-card"><h3>Recent audit events</h3>{audit.map((row) => <div className="ops-row" key={String(row.id)}><span>{String(row.action)} · {String(row.entity_type)}</span><small>{new Date(String(row.created_at)).toLocaleString()}</small></div>)}</div>
      <div className="ops-card"><h3>Release pipeline</h3><p className="ops-hint">This controls publication of a complete dataset release. It is separate from approving or rejecting individual participant recordings.</p>{releases.length ? releases.map((row) => <div className="ops-row" key={String(row.id)}><span>{String(row.name)} {String(row.version)} | {String(row.status)}{row.rejection_reason ? ` | ${String(row.rejection_reason)}` : ""}</span>{row.status === "draft" && <button onClick={() => advanceRelease(String(row.id), "privacy_review")}>Send to privacy review</button>}{row.status === "privacy_review" && <><button onClick={() => returnReleaseToDraft(String(row.id))}>Return to draft</button><button className="danger" onClick={() => rejectRelease(String(row.id))}>Reject</button><button onClick={() => advanceRelease(String(row.id), "approved")}>Approve</button></>}{row.status === "rejected" && <button onClick={() => returnReleaseToDraft(String(row.id))}>Return to draft</button>}{row.status === "approved" && <button onClick={() => advanceRelease(String(row.id), "published")}>Publish</button>}</div>) : <p>No release drafts.</p>}</div>
    </div>
  </section>;
}
