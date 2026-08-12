"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { backendConfigured, getSupabase } from "../lib/supabase";
import { Mark } from "../lib/ui";

export default function SignUpPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [loading, setLoading] = useState(false);

  const passwordsMatch = password.length >= 8 && password === confirmPassword;

  async function handleSignUp() {
    setMessage("");
    const supabase = getSupabase();
    if (!supabase) {
      setMessage("Supabase is not configured yet. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to enable sign-up.");
      return;
    }
    if (!passwordsMatch) {
      setMessage("Passwords must match and be at least 8 characters.");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName || undefined, requesting_staff_access: true } },
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    if (data.session) {
      router.push("/");
      return;
    }
    setAwaitingConfirmation(true);
  }

  return (
    <main>
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-icon"><i /><i /><i /></span>
          <span>Naija<span>Vision</span></span>
        </Link>
        <div className="top-context"><span className="privacy-dot" /> Staff sign up</div>
      </header>

      <section className="shell narrow">
        <div className="section-head">
          <div>
            <div className="eyebrow">Reviewer &amp; administrator access</div>
            <h2>Create a staff account.</h2>
            <p>This creates a plain account with no special access. An administrator must grant reviewer or admin permissions afterward from the reviewer workspace.</p>
          </div>
        </div>

        {!backendConfigured && (
          <div className="notice">
            <Mark>i</Mark>
            <p>Supabase is not connected yet. This page will work once <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> are set.</p>
          </div>
        )}

        {awaitingConfirmation ? (
          <div className="notice">
            <Mark>✓</Mark>
            <p><b>Check your email.</b> We sent a confirmation link to {email}. Confirm your address, then <Link href="/signin">sign in</Link>.</p>
          </div>
        ) : (
          <>
            <div className="form-grid">
              <label className="wide">
                <span>Full name <small>optional</small></span>
                <input type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Adaeze Nwosu" />
              </label>
              <label className="wide">
                <span>Email</span>
                <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </label>
              <label>
                <span>Password</span>
                <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
              </label>
              <label>
                <span>Confirm password</span>
                <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" />
              </label>
            </div>

            {message && <p className="auth-message">{message}</p>}

            <div className="footer-actions">
              <Link className="secondary" href="/signin">Already have an account?</Link>
              <button className="primary" disabled={loading || !email.trim() || !passwordsMatch} onClick={handleSignUp}>
                {loading ? "Creating account…" : "Create account"}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
