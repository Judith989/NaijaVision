"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { backendConfigured, getSupabase } from "../lib/supabase";
import { Mark } from "../lib/ui";

export default function SignUpPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [loading, setLoading] = useState(false);
  const [staffMode, setStaffMode] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setStaffMode(new URLSearchParams(window.location.search).get("staff") === "1"));
    const supabase = getSupabase();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace("/dashboard");
    });
  }, [router]);

  const passwordsMatch = password.length >= 8 && password === confirmPassword;
  const capitalizeName = (value: string) => value.trim().replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());

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
    if (!firstName.trim() || !lastName.trim()) {
      setMessage("Enter your First name and Last name.");
      return;
    }
    const normalizedFirstName = capitalizeName(firstName);
    const normalizedLastName = capitalizeName(lastName);
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: {
        first_name: normalizedFirstName,
        last_name: normalizedLastName,
        full_name: `${normalizedFirstName} ${normalizedLastName}`,
        requesting_staff_access: staffMode,
      } },
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    if (data.session) {
      router.push("/dashboard");
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
        <div className="top-context"><span className="privacy-dot" /> {staffMode ? "Staff access request" : "Participant sign up"}</div>
      </header>

      <section className="shell narrow">
        <div className="section-head">
          <div>
            <div className="eyebrow">{staffMode ? "Reviewer and administrator access" : "Open research participation"}</div>
            <h2>{staffMode ? "Request a staff account." : "Create your participant account."}</h2>
            <p>{staffMode ? "This creates a plain account with no special access. An administrator must approve reviewer or admin permissions afterward." : "Use this account to contribute recordings, save progress, follow review decisions, and receive approved compensation."}</p>
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
            <p><b>Check your email.</b> NaijaVision sent a confirmation link to {email}. Confirm your address, then <Link href="/signin?next=/dashboard">sign in</Link>.</p>
          </div>
        ) : (
          <>
            <div className="form-grid">
              <label>
                <span>First name</span>
                <input type="text" autoComplete="given-name" autoCapitalize="words" value={firstName} onChange={(e) => setFirstName(e.target.value)} onBlur={() => setFirstName(capitalizeName(firstName))} placeholder="e.g. Adaeze" />
              </label>
              <label>
                <span>Last name</span>
                <input type="text" autoComplete="family-name" autoCapitalize="words" value={lastName} onChange={(e) => setLastName(e.target.value)} onBlur={() => setLastName(capitalizeName(lastName))} placeholder="e.g. Nwosu" />
              </label>
              <label className="wide">
                <span>Email</span>
                <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </label>
              <label>
                <span>Password</span>
                <div className="password-field"><input type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button></div>
              </label>
              <label>
                <span>Confirm password</span>
                <div className="password-field"><input type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" /><button type="button" onClick={() => setShowConfirmPassword((visible) => !visible)} aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}>{showConfirmPassword ? "Hide" : "Show"}</button></div>
              </label>
            </div>

            {message && <p className="auth-message">{message}</p>}

            <div className="footer-actions">
          <Link className="secondary" href="/signin?next=/dashboard">Already have an account?</Link>
              <button className="primary" disabled={loading || !firstName.trim() || !lastName.trim() || !email.trim() || !passwordsMatch} onClick={handleSignUp}>
                {loading ? "Creating account…" : "Create account"}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
