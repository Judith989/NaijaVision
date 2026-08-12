"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { backendConfigured, getSupabase } from "../lib/supabase";
import { Mark } from "../lib/ui";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setMessage("");
    const supabase = getSupabase();
    if (!supabase) {
      setMessage("Supabase is not configured yet. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to enable sign-in.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    router.push("/");
  }

  return (
    <main>
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-icon"><i /><i /><i /></span>
          <span>Naija<span>Vision</span></span>
        </Link>
        <div className="top-context"><span className="privacy-dot" /> Staff sign in</div>
      </header>

      <section className="shell narrow">
        <div className="section-head">
          <div>
            <div className="eyebrow">Reviewer &amp; administrator access</div>
            <h2>Sign in to your account.</h2>
            <p>This page is for reviewers and administrators. Participants should use &ldquo;Begin contribution&rdquo; on the home page instead.</p>
          </div>
        </div>

        {!backendConfigured && (
          <div className="notice">
            <Mark>i</Mark>
            <p>Supabase is not connected yet. This page will work once <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> are set.</p>
          </div>
        )}

        <div className="form-grid">
          <label className="wide">
            <span>Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label className="wide">
            <span>Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" />
          </label>
        </div>

        {message && <p className="auth-message">{message}</p>}

        <div className="footer-actions">
          <Link className="secondary" href="/forgot-password">Forgot password?</Link>
          <button className="primary" disabled={loading || !email.trim() || !password} onClick={handleSignIn}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </div>

        <p className="auth-switch">Don&apos;t have a staff account? <Link href="/signup">Create one</Link></p>
      </section>
    </main>
  );
}
