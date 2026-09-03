"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getCurrentRole, getSupabase } from "../lib/supabase";

type Submission = { id: string; status: string; expected_recordings: number; accepted_recordings: number; compensation_amount: number | null; compensation_currency: string | null; compensation_rate: number | null; compensation_basis: string | null; completed_language_count: number; completed_standard_language_count: number; completed_safe_speech_language_count: number; created_at: string; submitted_at: string | null; reviewed_at: string | null; paid_at: string | null };
type Notice = { id: string; title: string; message: string; read_at: string | null; created_at: string };
type SurveyResponses = { primary?: string; nativeLanguages?: string[]; dailyLanguages?: string[]; otherLanguages?: string[] };
type Payment = { submission_id: string; amount: number; currency: string; status: string };
type ReviewerPayment = { reviewed_video_count: number; rate_per_video: number; amount: number; currency: string; status: string };
const reviewStatuses = ["submitted", "automated_qc", "awaiting_review", "changes_requested", "resubmitted", "approved", "payment_eligible", "payment_processing", "paid"];

function humanStatus(value?: string) { return value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Not started"; }
function readableNotice(notice: Notice) {
  const generic = notice.message === "Open NaijaVision to view the latest status of your contribution.";
  if (!generic) return notice.message;
  const title = notice.title.toLowerCase();
  if (title.includes("rejected")) return "Your submission was declined and is not eligible for compensation. Contact support if you need more information about the decision.";
  if (title.includes("changes")) return "Some recordings need to be completed again. Open your contribution to view and replace the affected recordings.";
  if (title.includes("approved")) return "Your submission passed final review and is now moving to compensation processing.";
  return "There is a new update about your contribution. View your review timeline for the current status.";
}

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"participant" | "reviewer" | "admin">("participant");
  const [participantId, setParticipantId] = useState("");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [recordings, setRecordings] = useState<Array<{ submission_id: string; language: string }>>([]);
  const [survey, setSurvey] = useState<SurveyResponses>({});
  const [hasConsent, setHasConsent] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [payout, setPayout] = useState<{ bank_name: string; account_last4: string; verified_at: string | null } | null>(null);
  const [policy, setPolicy] = useState<{ amount: number; currency: string; minimum_accepted_recordings: number; pricing_basis: string } | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [reviewerPayments, setReviewerPayments] = useState<ReviewerPayment[]>([]);
  const [readyChecks, setReadyChecks] = useState<string[]>([]);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) { router.replace("/signin?next=/dashboard"); return; }
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { router.replace("/signin?next=/dashboard"); return; }
      setRole(await getCurrentRole());
      const [profileResult, submissionsResult, surveyResult, consentResult, noticeResult, payoutResult, policyResult, paymentResult, recordingResult, reviewerPaymentResult] = await Promise.all([
        supabase.from("profiles").select("participant_id").eq("user_id", data.user.id).maybeSingle(),
        supabase.from("submissions").select("id,status,expected_recordings,accepted_recordings,compensation_amount,compensation_currency,compensation_rate,compensation_basis,completed_language_count,completed_standard_language_count,completed_safe_speech_language_count,created_at,submitted_at,reviewed_at,paid_at").eq("user_id", data.user.id).order("created_at", { ascending: false }),
        supabase.from("surveys").select("responses").eq("user_id", data.user.id).order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("consents").select("id").eq("user_id", data.user.id).is("withdrawn_at", null).limit(1),
        supabase.from("notifications").select("id,title,message,read_at,created_at").eq("user_id", data.user.id).order("created_at", { ascending: false }).limit(5),
        supabase.from("payout_accounts").select("bank_name,account_last4,verified_at").eq("user_id", data.user.id).maybeSingle(),
        supabase.from("compensation_policies").select("amount,currency,minimum_accepted_recordings,pricing_basis").is("retired_at", null).order("effective_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("payments").select("submission_id,amount,currency,status").eq("user_id", data.user.id),
        supabase.from("recordings").select("submission_id,language").eq("user_id", data.user.id),
        supabase.from("reviewer_payments").select("reviewed_video_count,rate_per_video,amount,currency,status").eq("reviewer_id", data.user.id),
      ]);
      setParticipantId(profileResult.data?.participant_id || "Pending");
      setSubmissions((submissionsResult.data || []) as Submission[]);
      setSurvey((surveyResult.data?.responses || {}) as SurveyResponses);
      setHasConsent(Boolean(consentResult.data?.length));
      setNotices((noticeResult.data || []) as Notice[]);
      setPayout(payoutResult.data || null);
      setPolicy(policyResult.data ? { ...policyResult.data, amount: Number(policyResult.data.amount) } : null);
      setPayments((paymentResult.data || []).map((item) => ({ ...item, amount: Number(item.amount) })) as Payment[]);
      setRecordings((recordingResult.data || []) as Array<{ submission_id: string; language: string }>);
      setReviewerPayments((reviewerPaymentResult.data || []).map((item) => ({ ...item, rate_per_video: Number(item.rate_per_video), amount: Number(item.amount) })) as ReviewerPayment[]);
      setLoading(false);
    });
  }, [router]);

  async function signOut() { await getSupabase()?.auth.signOut(); router.replace("/"); }
  async function markNoticeRead(id: string) {
    const readAt = new Date().toISOString();
    const { error } = await getSupabase()!.from("notifications").update({ read_at: readAt }).eq("id", id);
    if (!error) setNotices((items) => items.map((item) => item.id === id ? { ...item, read_at: readAt } : item));
  }
  const latest = submissions[0];
  const latestRecordings = useMemo(() => latest ? recordings.filter((item) => item.submission_id === latest.id) : [], [latest, recordings]);
  const target = latest?.expected_recordings || policy?.minimum_accepted_recordings || 75;
  const completed = latestRecordings.length;
  const progress = Math.min(100, Math.round((completed / target) * 100));
  const estimatedMinutes = Math.max(0, Math.ceil((target - completed) * 0.45));
  const latestPayment = latest ? payments.find((item) => item.submission_id === latest.id) : undefined;
  const languages = useMemo(() => Array.from(new Set([survey.primary, ...(survey.nativeLanguages || []), ...(survey.dailyLanguages || []), ...(survey.otherLanguages || []), ...latestRecordings.map((item) => item.language)].filter(Boolean) as string[])), [survey, latestRecordings]);
  const displayedCompensation = latest?.compensation_amount ?? 0;
  const reviewerVideoCount = reviewerPayments.reduce((total, item) => total + item.reviewed_video_count, 0);
  const reviewerEarnings = reviewerPayments.reduce((total, item) => total + item.amount, 0);
  const approved = submissions.filter((item) => ["approved", "payment_eligible", "payment_processing", "paid"].includes(item.status)).length;
  const requiresRedo = latest?.status === "changes_requested";
  const activeReviewIndex = latest ? Math.max(0, reviewStatuses.indexOf(latest.status)) : -1;
  const nextLabel = requiresRedo ? "Fix requested recordings" : latest && ["recording", "uploading", "draft"].includes(latest.status) ? "Continue contribution" : latest && ["submitted", "automated_qc", "awaiting_review", "resubmitted"].includes(latest.status) ? "View review status" : latest && ["paid", "rejected", "withdrawn"].includes(latest.status) ? "Start another contribution" : "Begin contribution";
  const progressSteps = [["Account created", true], ["Consent", hasConsent], ["Language survey", Boolean(survey.primary)], ["Device checks", Boolean(latest)], ["Recordings", completed >= target], ["Submitted", Boolean(latest?.submitted_at)]] as Array<[string, boolean]>;
  const timeline = [["Submitted", activeReviewIndex >= 0], ["Automated checks", activeReviewIndex >= 1], ["Human review", activeReviewIndex >= 2], ["Approved", Boolean(latest && ["approved", "payment_eligible", "payment_processing", "paid"].includes(latest.status))], ["Paid", latest?.status === "paid"]] as Array<[string, boolean]>;
  const readiness = ["Quiet location", "Good lighting", "Camera available", "Microphone available", "30 to 45 minutes available"];

  if (loading) return <main><section className="shell narrow"><p>Loading your private contribution dashboard...</p></section></main>;

  return <main><header className="topbar"><Link href="/" className="brand"><span className="brand-icon"><i /><i /><i /></span><span>Naija<span>Vision</span></span></Link><div className="top-context"><span className="privacy-dot" /> Participant dashboard</div><nav className="workspace-nav" aria-label="Account workspaces">{role === "reviewer" && <Link className="admin-link" href="/?reviewer=1">Reviewer workspace</Link>}{role === "admin" && <><Link className="admin-link" href="/?reviewer=1">Review workspace</Link><Link className="admin-link" href="/?reviewer=1&workspace=admin">Admin workspace</Link></>}<button className="admin-link" onClick={signOut}>Sign out</button></nav></header>
    <section className="dashboard-shell enhanced-dashboard">
      <div className="dashboard-hero-panel"><div><div className="eyebrow light">Private participant workspace</div><h1>Welcome back.</h1><p>Signed in as <b>{participantId}</b>. Your name and email are intentionally not displayed here.</p></div><div className="hero-next-action"><small>Recommended next step</small><Link className="dashboard-cta" href={nextLabel === "View review status" ? "/dashboard#review-status" : "/?contribute=1"}>{nextLabel} <span>→</span></Link></div></div>
      {(requiresRedo || notices.some((item) => !item.read_at)) && <div className="action-banner"><b>Action required</b><span>{requiresRedo ? "A reviewer returned recordings for correction. Open your contribution to see what must be redone." : "You have an unread contribution update."}</span><Link href={requiresRedo ? "/?contribute=1" : "#notifications"}>Review now</Link></div>}
      <div className="dashboard-metrics"><div><small>Participant ID</small><b>{participantId}</b><em>Pseudonymous research identity</em></div><div><small>Recording target</small><b>{completed} of {target}</b><em>{estimatedMinutes} minutes estimated</em></div><div><small>Approved submissions</small><b>{approved}</b><em>{submissions.length} total submissions</em></div><div><small>Latest status</small><b>{humanStatus(latest?.status)}</b><em>{latest?.created_at ? new Date(latest.created_at).toLocaleDateString() : "No contribution yet"}</em></div></div>
      <div className="dashboard-primary-grid"><section className="dashboard-card progress-card"><div className="card-heading"><div><small>Contribution progress</small><h2>{progress}% complete</h2></div><span>{completed}/{target} recordings</span></div><div className="dashboard-progress"><i style={{ width: `${progress}%` }} /></div><div className="progress-steps">{progressSteps.map(([label, done], index) => <div className={done ? "done" : index === progressSteps.findIndex((item) => !item[1]) ? "current" : ""} key={label}><span>{done ? "✓" : index + 1}</span><b>{label}</b></div>)}</div></section><aside className="dashboard-card compensation-card"><small>Participant earnings</small><h2>{policy ? `${policy.currency === "NGN" ? "₦" : policy.currency + " "}${Number(displayedCompensation).toLocaleString()}` : "Policy pending"}</h2>{policy?.pricing_basis === "per_language" && <small className="rate-note">{latest?.compensation_basis === "per_language_completed" ? `${latest.completed_standard_language_count || 0} regular + ${latest.completed_safe_speech_language_count || 0} NaijaSafeSpeech language sets × ₦${(latest.compensation_rate ?? policy.amount).toLocaleString()}` : "Legacy agreed amount"}</small>}<span className={`eligibility ${latestPayment?.status === "paid" ? "eligible" : ""}`}>{latestPayment ? humanStatus(latestPayment.status) : "Not yet eligible"}</span><div className="payment-destination"><small>Payment destination</small><b>{payout ? `${payout.bank_name} ••••${payout.account_last4}` : "Add and verify bank details"}</b></div><p>Each completed regular language set earns ₦500. Each completed NaijaSafeSpeech language set earns another ₦500. Payment becomes payable after final approval.</p></aside></div>
      {(role === "reviewer" || role === "admin") && <section className="dashboard-card"><div className="card-heading"><div><small>Reviewer earnings</small><h2>₦{reviewerEarnings.toLocaleString()}</h2></div><span>{reviewerVideoCount} unique videos reviewed</span></div><p className="dashboard-note">Reviewer compensation is ₦10 per unique video. Rechecking the same video does not create a duplicate fee. Payment status is managed separately from participant compensation.</p></section>}
      <section className="dashboard-card review-card" id="review-status"><div className="card-heading"><div><small>Submission tracking</small><h2>Review and payment timeline</h2></div><b>{humanStatus(latest?.status)}</b></div><div className="review-timeline">{timeline.map(([label, done], index) => <div className={done ? "done" : ""} key={label}><span>{done ? "✓" : index + 1}</span><b>{label}</b>{index < timeline.length - 1 && <i />}</div>)}</div></section>
      <div className="dashboard-content-grid"><section className="dashboard-card"><div className="card-heading"><div><small>Prompt assignment</small><h2>Your languages</h2></div></div>{languages.length ? <div className="language-tags">{languages.map((language) => <span key={language}>{language}</span>)}</div> : <div className="dashboard-empty compact"><p>Your selected languages will appear after the survey.</p></div>}<p className="dashboard-note">Only prompts matching your selected language background are assigned.</p></section><section className="dashboard-card"><div className="card-heading"><div><small>Before recording</small><h2>Readiness checklist</h2></div></div><div className="readiness-list">{readiness.map((item) => <label key={item}><input type="checkbox" checked={readyChecks.includes(item)} onChange={() => setReadyChecks((checks) => checks.includes(item) ? checks.filter((value) => value !== item) : [...checks, item])} /><span>{item}</span></label>)}</div></section></div>
      <section className="dashboard-card notifications-card" id="notifications"><div className="card-heading"><div><small>Account updates</small><h2>Notifications</h2></div><span className="unread-count">{notices.filter((item) => !item.read_at).length} unread</span></div>{notices.length ? <div className="dashboard-notices">{notices.map((notice) => <article className={!notice.read_at ? "unread" : ""} key={notice.id}><span aria-hidden="true">i</span><div><div className="notice-title"><b>{notice.title}</b>{!notice.read_at && <em>New</em>}</div><p>{readableNotice(notice)}</p><small>{new Date(notice.created_at).toLocaleString()}</small></div>{!notice.read_at && <button onClick={() => markNoticeRead(notice.id)}>Mark as read</button>}</article>)}</div> : <div className="dashboard-empty compact"><p>No updates yet. Review decisions and payment changes will appear here.</p></div>}</section>
      <section className="dashboard-card history-card"><div className="card-heading"><div><small>Research contributions</small><h2>Contribution history</h2></div><Link href="/?contribute=1">New contribution</Link></div>{submissions.length ? submissions.map((submission) => { const count = recordings.filter((item) => item.submission_id === submission.id).length; const payment = payments.find((item) => item.submission_id === submission.id); return <div className="history-row" key={submission.id}><div><b>{new Date(submission.created_at).toLocaleDateString()}</b><small>{count} of {submission.expected_recordings} recordings</small></div><span>{humanStatus(submission.status)}</span><span>{payment ? humanStatus(payment.status) : "Payment pending"}</span><Link href="#review-status">View status</Link></div>; }) : <div className="first-contribution"><div className="empty-orbit"><span>0</span><i /></div><div><h3>Your first contribution starts here</h3><p>Choose your languages, complete the recording checks, and submit your recordings for human review.</p><div><span>30 to 45 minutes</span><span>{target} prompts</span><span>Payment after approval</span></div><Link className="primary" href="/?contribute=1">Start first contribution</Link></div></div>}</section>
      <div className="dashboard-content-grid bottom-grid"><details className="dashboard-card privacy-card"><summary><span><small>Privacy and control</small><b>How your information is protected</b></span><i>+</i></summary><div><p>NaijaVision records mouth-region video and audio. These remain potentially identifiable biometric data.</p><ul><li>Your participant ID is used in research records.</li><li>Contact and payment details are stored separately from research data.</li><li>Released datasets exclude names, email, account details, and authentication records.</li><li>You can request withdrawal, subject to limitations after public release.</li></ul></div></details><section className="dashboard-card"><div className="card-heading"><div><small>Quick actions</small><h2>Account and support</h2></div></div><Link className="quick-action" href="/?contribute=1"><span>Record a contribution</span><small>Start or continue</small></Link><Link className="quick-action" href="/?contribute=1&payment=edit"><span>Update payment details</span><small>{payout ? `Current account ending ${payout.account_last4}` : "Add payment account"}</small></Link>{role === "reviewer" && <Link className="quick-action" href="/?reviewer=1"><span>Reviewer workspace</span><small>Internal access</small></Link>}{role === "admin" && <Link className="quick-action" href="/?reviewer=1&workspace=admin"><span>Admin workspace</span><small>Roles, reviews, payments, and governance</small></Link>}<Link className="quick-action" href="/forgot-password"><span>Change password</span><small>Account security</small></Link><a className="quick-action" href="mailto:naijavisionresearch@gmail.com"><span>Contact support</span><small>Get help</small></a></section></div>
    </section></main>;
}
