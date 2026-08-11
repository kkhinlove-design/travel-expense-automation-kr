"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function AccountPasswordForm({ user, signOutPath }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (newPassword.length < 8) {
      setError("새 비밀번호는 8자 이상 입력해 주세요.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("새 비밀번호와 확인 비밀번호가 일치하지 않습니다.");
      return;
    }
    if (currentPassword === newPassword) {
      setError("현재 비밀번호와 다른 새 비밀번호를 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await getSupabaseBrowserClient().auth.updateUser({
        password: newPassword,
        current_password: currentPassword,
      });
      if (updateError) {
        if (/current.*password|invalid.*password|credentials/i.test(updateError.message)) {
          throw new Error("현재 비밀번호가 올바르지 않습니다.");
        }
        throw updateError;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "비밀번호를 변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f4f6fa" }}>
      <div style={{ width: "min(100%, 480px)" }}>
        <form onSubmit={submit} style={{ padding: 32, borderRadius: 18, background: "#fff", boxShadow: "0 14px 50px #1d2b4418" }}>
          <p style={{ margin: 0, color: "#667085", fontSize: 13, fontWeight: 800, letterSpacing: "0.12em" }}>MY ACCOUNT</p>
          <h1 style={{ margin: "10px 0 8px", color: "#172033" }}>내 계정</h1>
          <p style={{ margin: 0, color: "#667085", lineHeight: 1.6 }}>로그인한 계정의 비밀번호를 변경할 수 있습니다.</p>
          <div style={{ marginTop: 20, padding: "12px 14px", borderRadius: 9, background: "#f5f8fc", color: "#475467", fontSize: 14 }}>
            <strong>{user.displayName || user.email}</strong><br />{user.email}
          </div>
          <label style={{ display: "block", marginTop: 22, fontWeight: 700 }}>현재 비밀번호</label>
          <input required type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" style={{ width: "100%", boxSizing: "border-box", margin: "8px 0 14px", padding: 13, border: "1px solid #ccd4e0", borderRadius: 8 }} />
          <label style={{ display: "block", fontWeight: 700 }}>새 비밀번호</label>
          <input required minLength={8} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" placeholder="8자 이상" style={{ width: "100%", boxSizing: "border-box", margin: "8px 0 14px", padding: 13, border: "1px solid #ccd4e0", borderRadius: 8 }} />
          <label style={{ display: "block", fontWeight: 700 }}>새 비밀번호 확인</label>
          <input required minLength={8} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" style={{ width: "100%", boxSizing: "border-box", margin: "8px 0 18px", padding: 13, border: "1px solid #ccd4e0", borderRadius: 8 }} />
          <button disabled={busy} style={{ width: "100%", padding: 13, border: 0, borderRadius: 8, background: "#214b8e", color: "#fff", fontWeight: 700 }}>{busy ? "변경 중…" : "비밀번호 변경"}</button>
          {message ? <p role="status" style={{ color: "#16704f", lineHeight: 1.6 }}>{message}</p> : null}
          {error ? <p role="alert" style={{ color: "#b42318", lineHeight: 1.6 }}>{error}</p> : null}
        </form>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 14, padding: "0 4px" }}>
          <a href="/travel" style={{ color: "#315895", fontSize: 14 }}>출장 화면으로 돌아가기</a>
          <a href={signOutPath} style={{ color: "#667085", fontSize: 14 }}>로그아웃</a>
        </div>
      </div>
    </main>
  );
}
