"use client";

import { useState } from "react";
import { C } from "./theme";
import { HBtn, HInput } from "./ui";
import { useSmartCoGen } from "./store";

const LOGO = "https://assetsprelogin.mettl.com/_next/image/?url=%2Fassets%2Flogo%2FMarsh-Mercer-Mettl.svg&w=256&q=75";

/** Email + password sign-in against /api/auth/login. On success the server sets
 *  an httpOnly session cookie and the store swaps to the workspace. */
export function Login() {
  const { signIn } = useSmartCoGen();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    const { error } = await signIn(email, password);
    if (error) {
      setError(error === "Invalid login credentials" ? "Incorrect email or password." : error);
      setBusy(false);
    }
    // on success the auth listener swaps the screen; leave busy=true so the
    // button stays disabled through the transition.
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
  };

  return (
    <div style={{ height: "100vh", display: "flex", background: "#fff", overflow: "hidden" }}>
      {/* brand panel */}
      <div
        style={{
          width: "46%",
          maxWidth: 680,
          flexShrink: 0,
          position: "relative",
          background: C.navyDeep,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "46px 56px",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", top: -180, right: -160, width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle,rgba(122,181,44,.16),transparent 68%)" }} />
        <div style={{ position: "absolute", bottom: -220, left: -160, width: 540, height: 540, borderRadius: "50%", background: "radial-gradient(circle,rgba(58,86,180,.22),transparent 70%)" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px)", backgroundSize: "54px 54px" }} />
        <div style={{ position: "relative", background: "#fff", borderRadius: 12, padding: "16px 24px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO} alt="Marsh Mercer Mettl" style={{ height: 40, display: "block" }} />
        </div>
        <div
          style={{
            position: "relative",
            marginTop: 26,
            maxWidth: 320,
            textAlign: "center",
            fontSize: 25,
            fontWeight: 800,
            color: "#fff",
            letterSpacing: "-.2px",
            lineHeight: 1.3,
          }}
        >
          Smart Content Generation
        </div>
      </div>

      {/* form panel */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 32px", background: "#F4F6F9", overflowY: "auto" }}>
        <div style={{ width: "100%", maxWidth: 392 }}>
          <h2 style={{ fontSize: 27, fontWeight: 800, color: C.navy, letterSpacing: "-.5px", margin: "0 0 30px" }}>Sign in</h2>

          <label style={{ fontSize: 13, fontWeight: 600, color: C.slate, display: "block", marginBottom: 8 }}>Work email</label>
          <HInput
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={onKey}
            autoFocus
            placeholder="firstname.lastname@mercer.com"
            style={{ width: "100%", height: 48, border: "1.5px solid #E3E8ED", borderRadius: 11, padding: "0 16px", fontSize: 15, color: C.navy, outline: "none", marginBottom: 18, background: "#fff" }}
            focusStyle={{ borderColor: C.navy }}
          />
          <label style={{ fontSize: 13, fontWeight: 600, color: C.slate, display: "block", marginBottom: 8 }}>Password</label>
          <HInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onKey}
            placeholder="Enter your password"
            style={{ width: "100%", height: 48, border: "1.5px solid #E3E8ED", borderRadius: 11, padding: "0 16px", fontSize: 15, color: C.navy, outline: "none", background: "#fff" }}
            focusStyle={{ borderColor: C.navy }}
          />
          {error && (
            <div style={{ marginTop: 16, padding: "10px 13px", borderRadius: 10, background: "#FCEBEC", border: "1px solid #F2C4C8", color: "#C0454B", fontSize: 13, fontWeight: 600 }}>{error}</div>
          )}
          <HBtn
            onClick={submit}
            disabled={busy}
            style={{ width: "100%", height: 50, marginTop: 26, background: C.navy, color: "#fff", border: "none", borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, boxShadow: "0 8px 20px rgba(0,15,71,.26)" }}
            hover={{ background: C.navyHover }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </HBtn>
        </div>
      </div>
    </div>
  );
}
