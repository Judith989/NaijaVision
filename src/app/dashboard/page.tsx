"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getCurrentRole, getSupabase } from "../lib/supabase";

type Submission = {
  id: string;
  status: string;
  expected_recordings: number;
  created_at: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"participant" | "reviewer" | "admin">("participant");
  const [participantId, setParticipantId] = useState("");
  const [submissions, setSubmissions] = useState<Submission[]>([]);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      router.replace("/signin?next=/dashboard");
      return;
    }
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.replace("/signin?next=/dashboard");
        return;
      }
      setEmail(data.user.email || data.user.phone || "Verified account");
      setRole(await getCurrentRole());
      const [{ data: profile }, { data: rows }] = await Promise.all([
        supabase.from("profiles").select("participant_id").eq("user_id", data.user.id).maybeSingle(),
        supabase.from("submissions").select("id,status,expected_recordings,created_at").eq("user_id", data.user.id).order("created_at", { ascending: false }),
      ]);
      setParticipantId(profile?.participant_id || "Pending");
      setSubmissions((rows || []) as Submission[]);
      setLoading(false);
    });
  }, [router]);

  async function signOut() {
    await getSupabase()?.auth.signOut();
    router.replace("/");
  }

  if (loading) return <main><section className="shell narrow"><p>Loading your NaijaVision dashboard...</p></section></main>;

  const latest = submissions[0];
  const approved = submissions.filter((item) => item.status === "approved" || item.status === "paid").length;

  return (
    <main>
      <header className="topbar">
        <Link href="/" className="brand"><span className="brand-icon"><i /><i /><i /></span><span>Naija<span>Vision</span></span></Link>
        <div className="top-context"><span className="privacy-dot" /> Participant dashboard</div>
        <button className="admin-link" onClick={signOut}>Sign out</button>
      </header>

      <section className="dashboard-shell">
        <div className="dashboard-welcome">
          <div><div className="eyebrow">Your contribution account</div><h1>Welcome to NaijaVision.</h1><p>{email}</p></div>
          <Link className="primary" href="/?contribute=1">Begin contribution <span>→</span></Link>
        </div>

        <div className="dashboard-metrics">
          <div><small>Participant ID</small><b>{participantId}</b></div>
          <div><small>Total submissions</small><b>{submissions.length}</b></div>
          <div><small>Approved</small><b>{approved}</b></div>
          <div><small>Latest status</small><b>{latest?.status.replaceAll("_", " ") || "Not started"}</b></div>
        </div>

        <div className="dashboard-grid">
          <section className="dashboard-card">
            <h2>Your contributions</h2>
            {submissions.length ? submissions.map((submission) => (
              <div className="dashboard-submission" key={submission.id}>
                <div><b>{new Date(submission.created_at).toLocaleDateString()}</b><small>{submission.expected_recordings} expected recordings</small></div>
                <span className={`status ${submission.status === "approved" || submission.status === "paid" ? "accepted" : "needs-review"}`}>{submission.status.replaceAll("_", " ")}</span>
              </div>
            )) : <div className="dashboard-empty"><p>You have not submitted a contribution yet.</p><Link href="/?contribute=1">Start your first contribution</Link></div>}
          </section>

          <aside className="dashboard-card">
            <h2>Account actions</h2>
            <Link className="quick-action" href="/?contribute=1"><span>Record a contribution</span><small>Start or continue</small></Link>
            {(role === "reviewer" || role === "admin") && <Link className="quick-action" href="/?reviewer=1"><span>Reviewer workspace</span><small>Review submissions</small></Link>}
            <Link className="quick-action" href="/forgot-password"><span>Change password</span><small>Account security</small></Link>
            <p className="dashboard-note">Payments become eligible only after a reviewer approves the complete submission.</p>
          </aside>
        </div>
      </section>
    </main>
  );
}
