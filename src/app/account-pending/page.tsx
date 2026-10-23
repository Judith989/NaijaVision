"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "../lib/supabase";

export default function AccountPendingPage() {
  const router = useRouter();
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);

  async function checkStatus() {
    const supabase = getSupabase();
    if (!supabase) { router.replace("/signin"); return; }
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { router.replace("/signin"); return; }
    const { data } = await supabase.from("profiles").select("account_status").eq("user_id", auth.user.id).maybeSingle();
    const nextStatus = data?.account_status || "pending";
    setStatus(nextStatus);
    setLoading(false);
    if (nextStatus === "active") router.replace("/dashboard");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void checkStatus(); }, 0);
    return () => window.clearTimeout(timer);
    // Status is checked once when this page opens and manually thereafter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function signOut() { await getSupabase()?.auth.signOut(); router.replace("/signin"); }

  return <main>
    <header className="topbar"><Link href="/" className="brand"><span className="brand-icon"><i /><i /><i /></span><span>Naija<span>Vision</span></span></Link><div className="top-context"><span className="privacy-dot" /> Account access</div></header>
    <section className="shell narrow">
      <div className="section-head"><div><div className="eyebrow">Account status</div><h2>{status === "closed" ? "Your account is closed." : status === "suspended" ? "Your account is suspended." : "Verify your email to continue."}</h2><p>{status === "closed" || status === "suspended" ? "Contact the NaijaVision team if you believe this was a mistake." : "Open the confirmation link in your signup email. Your account becomes active automatically after verification."}</p></div></div>
      <div className="notice"><p>{loading ? "Checking your account status..." : status === "pending" ? "After verifying your email, select Check status. If you have already verified and still cannot continue, contact the NaijaVision team." : `Current account status: ${status}.`}</p></div>
      <div className="footer-actions"><button className="secondary" onClick={signOut}>Sign out</button><button className="primary" disabled={loading} onClick={checkStatus}>Check status</button></div>
    </section>
  </main>;
}
