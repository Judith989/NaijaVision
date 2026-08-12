"use client";

import { useState } from "react";
import Link from "next/link";
import { backendConfigured, getSupabase } from "../lib/supabase";
import { BASE_PATH } from "../lib/basePath";
import { Mark } from "../lib/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleRequestReset() {
    setMessage("");
    const supabase = getSupabase();
    if (!supabase) {
      setMessage("Supabase is not configured yet. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to enable password resets.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${BASE_PATH}/reset-password`,
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <main>
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-icon"><i /><i /><i /></span>
          <span>Naija<span>Vision</span></span>
        </Link>
        <div className="top-context"><span className="privacy-dot" /> Password reset</div>
      </header>

      <section className="shell narrow">
        <div className="section-head">
          <div>
            <div className="eyebrow">Reviewer &amp; administrator access</div>
            <h2>Reset your password.</h2>
            <p>Enter the email on your staff account and we&apos;ll send a link to set a new password.</p>
          </div>
        </div>

        {!backendConfigured && (
          <div className="notice">
            <Mark>i</Mark>
            <p>Supabase is not connected yet. This page will work once <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> are set.</p>
          </div>
        )}

        {sent ? (
          <div className="notice">
            <Mark>✓</Mark>
            <p>If an account exists for {email}, a reset link has been sent. Follow the link in that email to choose a new password.</p>
          </div>
        ) : (
          <>
            <div className="form-grid">
              <label className="wide">
                <span>Email</span>
                <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </label>
            </div>

            {message && <p className="auth-message">{message}</p>}

            <div className="footer-actions">
              <Link className="secondary" href="/signin">Back to sign in</Link>
              <button className="primary" disabled={loading || !email.trim()} onClick={handleRequestReset}>
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
