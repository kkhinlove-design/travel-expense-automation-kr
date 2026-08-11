"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { ORGANIZATION_CONFIG } from "@/config/organization";

function safeReturnTo() {
  const value = new URLSearchParams(window.location.search).get("return_to") || "/travel";
  return value.startsWith("/") ? value : "/travel";
}

export default function SignInPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "reset") setMode("reset");
    if (params.get("error")) setError(params.get("error"));
  }, []);

  function changeMode(nextMode) {
    setMode(nextMode);
    setMessage("");
    setError("");
    setPassword("");
    setNewPassword("");
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    const supabase = getSupabaseBrowserClient();
    try {
      if (mode === "reset") {
        if (newPassword.length < 8) throw new Error("새 비밀번호는 8자 이상 입력해 주세요.");
        const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
        if (updateError) throw updateError;
        changeMode("login");
        setMessage("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.");
        return;
      }
      const { error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (loginError) throw loginError;
      window.location.assign(safeReturnTo());
    } catch (submitError) {
      const text = submitError?.message || "로그인 처리 중 오류가 발생했습니다.";
      if (/invalid login credentials/i.test(text)) setError("이메일 또는 비밀번호가 올바르지 않습니다.");
      else setError(text);
    } finally {
      setBusy(false);
    }
  }

  async function sendResetEmail() {
    if (!email.trim()) {
      setError("비밀번호를 재설정할 이메일을 먼저 입력해 주세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    const { error: resetError } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?return_to=${encodeURIComponent("/signin?mode=reset")}`,
    });
    if (resetError) setError(resetError.message);
    else setMessage("비밀번호 재설정 메일을 보냈습니다. 이 기능은 계정 복구 때만 사용합니다.");
    setBusy(false);
  }

  const reset = mode === "reset";
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f4f6fa" }}>
      <form onSubmit={submit} style={{ width: "min(100%, 420px)", padding: 32, borderRadius: 18, background: "#fff", boxShadow: "0 14px 50px #1d2b4418" }}>
        <h1 style={{ margin: "0 0 10px" }}>{reset ? "비밀번호 재설정" : `${ORGANIZATION_CONFIG.appName} 로그인`}</h1>
        <p style={{ color: "#667085", lineHeight: 1.6 }}>{reset ? "새 비밀번호를 입력해 주세요." : "관리자가 만든 이메일과 비밀번호로 로그인합니다."}</p>
        {!reset && <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" autoComplete="email" style={{ width: "100%", boxSizing: "border-box", margin: "16px 0 10px", padding: 13, border: "1px solid #ccd4e0", borderRadius: 8 }} />}
        {reset ? (
          <input required minLength={8} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="새 비밀번호(8자 이상)" autoComplete="new-password" style={{ width: "100%", boxSizing: "border-box", margin: "16px 0", padding: 13, border: "1px solid #ccd4e0", borderRadius: 8 }} />
        ) : (
          <input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="비밀번호" autoComplete="current-password" style={{ width: "100%", boxSizing: "border-box", margin: "0 0 16px", padding: 13, border: "1px solid #ccd4e0", borderRadius: 8 }} />
        )}
        <button disabled={busy} style={{ width: "100%", padding: 13, border: 0, borderRadius: 8, background: "#214b8e", color: "#fff", fontWeight: 700 }}>{busy ? "처리 중…" : reset ? "비밀번호 변경" : "로그인"}</button>
        {!reset && <button type="button" onClick={sendResetEmail} disabled={busy} style={{ width: "100%", marginTop: 10, padding: 10, border: 0, background: "transparent", color: "#315895" }}>비밀번호를 잊으셨나요?</button>}
        {!reset && <a href="/admin" style={{ display: "block", marginTop: 18, textAlign: "center", fontSize: 14, color: "#667085" }}>관리자 계정 관리</a>}
        {reset && <button type="button" onClick={() => changeMode("login")} style={{ width: "100%", marginTop: 10, padding: 10, border: 0, background: "transparent", color: "#315895" }}>로그인으로 돌아가기</button>}
        {message ? <p style={{ marginBottom: 0, color: "#315895", lineHeight: 1.6 }}>{message}</p> : null}
        {error ? <p role="alert" style={{ marginBottom: 0, color: "#b42318", lineHeight: 1.6 }}>{error}</p> : null}
      </form>
    </main>
  );
}
