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
    <header className="topbar"><Link href="/" className="brand"><span className="brand-icon"><i /><i /><i /></span><span>Naija<span>Vision</span></span></Link><div className="top-context"><span className="privacy-dot" /> Account approval</div></header>
    <section className="shell narrow">
      <div className="section-head"><div><div className="eyebrow">Account review</div><h2>{status === "closed" ? "Your account request was declined." : "Your account is awaiting approval."}</h2><p>{status === "closed" ? "Contact the NaijaVision team if you believe this was a mistake." : "An administrator must approve new accounts before surveys, consent, recordings, or staff work can begin."}</p></div></div>
      <div className="notice"><p>{loading ? "Checking your approval status..." : status === "pending" ? "No action is needed right now. Use Check status after the team confirms your approval." : `Current account status: ${status}.`}</p></div>
      <div className="footer-actions"><button className="secondary" onClick={signOut}>Sign out</button><button className="primary" disabled={loading} onClick={checkStatus}>Check status</button></div>
    </section>
  </main>;
}
