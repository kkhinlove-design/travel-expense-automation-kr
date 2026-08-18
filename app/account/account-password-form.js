"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function AccountPasswordForm({
  user,
  signOutPath,
  originBases,
  initialDefaultOrigin,
  reportApproverTitles,
  initialReportApprovalLine,
  preferenceWritable,
  preferenceLoadError,
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [defaultOrigin, setDefaultOrigin] = useState(initialDefaultOrigin || "");
  const [reportApprovalLine, setReportApprovalLine] = useState(initialReportApprovalLine);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const [preferenceError, setPreferenceError] = useState(preferenceLoadError || "");

  async function submitPreference(event) {
    event.preventDefault();
    setPreferenceMessage("");
    setPreferenceError("");
    if (!defaultOrigin) {
      setPreferenceError("기본 출발 사무소를 선택해 주세요.");
      return;
    }
    if (reportApprovalLine.some((title) => !title)) {
      setPreferenceError("1차 결재자와 최종 결재자를 모두 선택해 주세요.");
      return;
    }
    if (reportApprovalLine[0] === reportApprovalLine[1]) {
      setPreferenceError("1차 결재자와 최종 결재자는 서로 다르게 선택해 주세요.");
      return;
    }
    setPreferenceBusy(true);
    try {
      const response = await fetch("/api/account/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultOrigin, reportApprovalLine }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "출장 환경 설정을 저장하지 못했습니다.");
      setDefaultOrigin(data.preference.defaultOrigin);
      setReportApprovalLine(data.preference.reportApprovalLine);
      setPreferenceMessage(`${data.preference.defaultOrigin} 사무소와 ${data.preference.reportApprovalLine.join(" → ")} 결재라인을 저장했습니다.`);
    } catch (submitError) {
      setPreferenceError(submitError instanceof Error ? submitError.message : "출장 환경 설정을 저장하지 못했습니다.");
    } finally {
      setPreferenceBusy(false);
    }
  }

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
      const supabase = getSupabaseBrowserClient();
      // GoTrue는 프로젝트 설정에 따라 current_password를 무시할 수 있고,
      // Secure password change도 최근 24시간 안에 로그인한 세션은 그냥 통과시킨다.
      // 그래서 현재 비밀번호는 앱에서 직접 확인한다. 이 재로그인은 세션도 새로
      // 만들어 주므로 뒤따르는 updateUser가 재인증 요구에 걸리지 않는다.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauthError) throw new Error("현재 비밀번호가 올바르지 않습니다.");

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
        current_password: currentPassword,
      });
      if (updateError) {
        if (/current.*password|invalid.*password|credentials/i.test(updateError.message)) {
          throw new Error("현재 비밀번호가 올바르지 않습니다.");
        }
        if (/reauthentication/i.test(updateError.message)) {
          throw new Error("보안 확인이 필요합니다. 다시 로그인한 뒤 시도해 주세요.");
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
      <div className="account-settings-shell" style={{ width: "100%", maxWidth: 560 }}>
        <section className="account-settings-panel" style={{ padding: 32, borderRadius: 18, background: "#fff", boxShadow: "0 14px 50px #1d2b4418" }}>
          <p style={{ margin: 0, color: "#667085", fontSize: 13, fontWeight: 800, letterSpacing: "0.12em" }}>MY ACCOUNT</p>
          <h1 style={{ margin: "10px 0 8px", color: "#172033" }}>내 환경 설정</h1>
          <p style={{ margin: 0, color: "#667085", lineHeight: 1.6 }}>출장 기본값과 로그인 비밀번호를 관리합니다.</p>
          <div style={{ marginTop: 20, padding: "12px 14px", borderRadius: 9, background: "#f5f8fc", color: "#475467", fontSize: 14 }}>
            <strong>{user.displayName || user.email}</strong><br />{user.email}
          </div>

          <form onSubmit={submitPreference} style={{ marginTop: 24, padding: 18, border: "1px solid #d9e2ef", borderRadius: 12, background: "#f8faff" }}>
            <h2 style={{ margin: 0, color: "#172033", fontSize: 19 }}>출장 기본값</h2>
            <p style={{ margin: "7px 0 14px", color: "#667085", fontSize: 14, lineHeight: 1.6 }}>새 출장을 시작할 때 출발 사무소와 복명서 결재라인에 자동 적용됩니다.</p>
            <label htmlFor="default-origin" style={{ display: "block", marginBottom: 8, fontWeight: 700 }}>출발 기준지</label>
            <select id="default-origin" value={defaultOrigin} onChange={(event) => setDefaultOrigin(event.target.value)} disabled={!preferenceWritable || preferenceBusy} style={{ width: "100%", minWidth: 0, minHeight: 46, padding: "0 12px", border: "1px solid #b9c7dc", borderRadius: 8, background: "#fff" }}>
              <option value="">기본 출발 사무소 선택</option>
              {originBases.map((origin) => <option key={origin} value={origin}>{origin} 사무소</option>)}
            </select>
            <fieldset style={{ margin: "18px 0 0", padding: 0, border: 0 }}>
              <legend style={{ marginBottom: 8, fontWeight: 700 }}>출장복명서 결재라인</legend>
              <div className="account-approval-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: 10 }}>
                <label><span style={{ display: "block", marginBottom: 6, color: "#667085", fontSize: 13 }}>1차 결재자</span><select value={reportApprovalLine[0]} onChange={(event) => setReportApprovalLine((current) => [event.target.value, current[1]])} disabled={!preferenceWritable || preferenceBusy} style={{ width: "100%", minHeight: 46, padding: "0 12px", border: "1px solid #b9c7dc", borderRadius: 8, background: "#fff" }}>{reportApproverTitles.map((title) => <option key={`first-${title}`} value={title}>{title}</option>)}</select></label>
                <span aria-hidden="true" style={{ paddingTop: 24, color: "#667085", fontWeight: 800 }}>→</span>
                <label><span style={{ display: "block", marginBottom: 6, color: "#667085", fontSize: 13 }}>최종 결재자</span><select value={reportApprovalLine[1]} onChange={(event) => setReportApprovalLine((current) => [current[0], event.target.value])} disabled={!preferenceWritable || preferenceBusy} style={{ width: "100%", minHeight: 46, padding: "0 12px", border: "1px solid #b9c7dc", borderRadius: 8, background: "#fff" }}>{reportApproverTitles.map((title) => <option key={`second-${title}`} value={title}>{title}</option>)}</select></label>
              </div>
              <p style={{ margin: "8px 0 0", color: "#667085", fontSize: 13, lineHeight: 1.6 }}>기존 2칸 결재 양식을 유지하고 직위만 바꿉니다.</p>
            </fieldset>
            <div style={{ marginTop: 16 }}>
              <button type="submit" disabled={!preferenceWritable || preferenceBusy} style={{ width: "100%", minHeight: 46, padding: "0 18px", border: 0, borderRadius: 8, background: "#214b8e", color: "#fff", fontWeight: 700 }}>{preferenceBusy ? "저장 중…" : "출장 기본값 저장"}</button>
            </div>
            {!preferenceWritable ? <p style={{ margin: "12px 0 0", color: "#667085", fontSize: 13, lineHeight: 1.6 }}>{preferenceLoadError ? "저장된 값을 다시 불러온 뒤 수정해 주세요." : "로컬 미리보기에서는 저장되지 않습니다. 로그인한 운영 사이트에서 설정해 주세요."}</p> : null}
            {preferenceMessage ? <p role="status" style={{ margin: "12px 0 0", color: "#16704f", lineHeight: 1.6 }}>{preferenceMessage}</p> : null}
            {preferenceError ? <p role="alert" style={{ margin: "12px 0 0", color: "#b42318", lineHeight: 1.6 }}>{preferenceError}</p> : null}
          </form>

          <div style={{ height: 1, margin: "28px 0 24px", background: "#e6e9ee" }} />
          <form onSubmit={submit}>
            <h2 style={{ margin: 0, color: "#172033", fontSize: 19 }}>비밀번호 변경</h2>
            <p style={{ margin: "7px 0 0", color: "#667085", fontSize: 14, lineHeight: 1.6 }}>현재 비밀번호를 확인한 뒤 새 비밀번호로 변경합니다.</p>
            <label style={{ display: "block", marginTop: 20, fontWeight: 700 }}>현재 비밀번호</label>
            <input required type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" style={{ width: "100%", boxSizing: "border-box", margin: "8px 0 14px", padding: 13, border: "1px solid #ccd4e0", borderRadius: 8 }} />
            <label style={{ display: "block", fontWeight: 700 }}>새 비밀번호</label>
            <input required minLength={8} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" placeholder="8자 이상" style={{ width: "100%", boxSizing: "border-box", margin: "8px 0 14px", padding: 13, border: "1px solid #ccd4e0", borderRadius: 8 }} />
            <label style={{ display: "block", fontWeight: 700 }}>새 비밀번호 확인</label>
            <input required minLength={8} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" style={{ width: "100%", boxSizing: "border-box", margin: "8px 0 18px", padding: 13, border: "1px solid #ccd4e0", borderRadius: 8 }} />
            <button disabled={busy} style={{ width: "100%", padding: 13, border: 0, borderRadius: 8, background: "#172033", color: "#fff", fontWeight: 700 }}>{busy ? "변경 중…" : "비밀번호 변경"}</button>
            {message ? <p role="status" style={{ color: "#16704f", lineHeight: 1.6 }}>{message}</p> : null}
            {error ? <p role="alert" style={{ color: "#b42318", lineHeight: 1.6 }}>{error}</p> : null}
          </form>
        </section>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 14, padding: "0 4px" }}>
          <a href="/travel" style={{ color: "#315895", fontSize: 14 }}>출장 화면으로 돌아가기</a>
          <a href={signOutPath} style={{ color: "#667085", fontSize: 14 }}>로그아웃</a>
        </div>
      </div>
    </main>
  );
}
