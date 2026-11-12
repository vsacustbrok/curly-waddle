import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg({ kind: "error", text: error.message });
    } else {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: name }, emailRedirectTo: window.location.origin },
      });
      if (error) {
        const uninvited = /not been invited|database error saving new user/i.test(error.message);
        setMsg({ kind: "error", text: uninvited ? "This email has not been invited yet. Ask the owner to invite you, then sign up again." : error.message });
      } else if (!data.session) setMsg({ kind: "ok", text: "Check your email for a confirmation link, then sign in." });
    }
    setBusy(false);
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <img className="login-logo" src="https://xskvjxbvkgysvwlotjpf.supabase.co/storage/v1/object/public/site-assets/vsacb-logo" alt="VSACB logo"
          onError={(e) => { e.currentTarget.style.display = "none"; }} />
        <h1>VSA Customs Brokerage</h1>
        <p className="muted">{mode === "in" ? "Sign in to your account" : "Create an account"}</p>
        {mode === "up" && (
          <label>Full name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        )}
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        <label>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
            autoComplete={mode === "in" ? "current-password" : "new-password"} />
        </label>
        {msg && <p className={msg.kind}>{msg.text}</p>}
        <button disabled={busy}>{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Sign up"}</button>
        <button type="button" className="ghost" onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }}>
          {mode === "in" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
        {mode === "up" && <p className="muted small">Only emails the owner has invited can sign up.</p>}
      </form>
    </div>
  );
}
