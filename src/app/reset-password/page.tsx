"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { backendConfigured, getSupabase } from "../lib/supabase";
import { Mark } from "../lib/ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordsMatch = password.length >= 8 && password === confirmPassword;

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setChecking(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setHasRecoverySession(Boolean(data.session));
      setChecking(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setHasRecoverySession(true);
        setChecking(false);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleSetPassword() {
    setMessage("");
    const supabase = getSupabase();
    if (!supabase) {
      setMessage("Supabase is not configured yet. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to enable password resets.");
      return;
    }
    if (!passwordsMatch) {
      setMessage("Passwords must match and be at least 8 characters.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
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
        <div className="top-context"><span className="privacy-dot" /> Password reset</div>
      </header>

      <section className="shell narrow">
        <div className="section-head">
          <div>
            <div className="eyebrow">Reviewer &amp; administrator access</div>
            <h2>Choose a new password.</h2>
          </div>
        </div>

        {!backendConfigured && (
          <div className="notice">
            <Mark>i</Mark>
            <p>Supabase is not connected yet. This page will work once <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> are set.</p>
          </div>
        )}

        {backendConfigured && checking && <p className="auth-message">Checking your reset link…</p>}

        {backendConfigured && !checking && !hasRecoverySession && (
          <div className="notice">
            <Mark>i</Mark>
            <p>This link is invalid or has expired. <Link href="/forgot-password">Request a new one</Link>.</p>
          </div>
        )}

        {(!backendConfigured || (!checking && hasRecoverySession)) && (
          <>
            <div className="form-grid">
              <label>
                <span>New password</span>
                <div className="password-field"><input type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button></div>
              </label>
              <label>
                <span>Confirm new password</span>
                <div className="password-field"><input type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" /><button type="button" onClick={() => setShowConfirmPassword((visible) => !visible)} aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}>{showConfirmPassword ? "Hide" : "Show"}</button></div>
              </label>
            </div>

            {message && <p className="auth-message">{message}</p>}

            <div className="footer-actions">
              <Link className="secondary" href="/signin">Back to sign in</Link>
              <button className="primary" disabled={loading || !passwordsMatch} onClick={handleSetPassword}>
                {loading ? "Saving…" : "Set new password"}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
