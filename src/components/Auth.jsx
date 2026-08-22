// src/components/Auth.jsx
// Simple Supabase email/password auth (sign in + sign up) for the Trade List app.
// Assumes a `supabase` client is created elsewhere, e.g. src/lib/supabaseClient.js:
//
//   import { createClient } from '@supabase/supabase-js';
//   export const supabase = createClient(
//     import.meta.env.VITE_SUPABASE_URL,
//     import.meta.env.VITE_SUPABASE_ANON_KEY
//   );

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Auth({ onAuthed }) {
  const [mode, setMode] = useState("sign_in"); // 'sign_in' | 'sign_up'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (mode === "sign_up") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;

        // If email confirmations are on, there's no session yet.
        if (!data.session) {
          setMessage("Check your email to confirm your account, then sign in.");
          setMode("sign_in");
        } else if (onAuthed) {
          onAuthed(data.session);
        }
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        if (onAuthed) onAuthed(data.session);
      }
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-card">
      <h2>{mode === "sign_in" ? "Log in" : "Create an account"}</h2>

      <form onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === "sign_up" ? "new-password" : "current-password"}
          />
        </label>

        {error && <p className="auth-error">{error}</p>}
        {message && <p className="auth-message">{message}</p>}

        <button type="submit" disabled={loading}>
          {loading ? "Please wait..." : mode === "sign_in" ? "Log in" : "Sign up"}
        </button>
      </form>

      <button
        type="button"
        className="auth-toggle"
        onClick={() => {
          setMode(mode === "sign_in" ? "sign_up" : "sign_in");
          setError(null);
          setMessage(null);
        }}
      >
        {mode === "sign_in"
          ? "Need an account? Sign up"
          : "Already have an account? Log in"}
      </button>
    </div>
  );
}
