"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { parseStaffAccountRows } from "@/lib/staff-account-import";
import { parseFareCatalogRows } from "@/lib/fare-catalog-import";
import { ADMIN_UI_CONFIG, hasAdminUiAccess } from "@/config/admin";
import styles from "./admin.module.css";

const MAX_BULK_USERS = 100;
const MAX_FARE_ROWS = 500;
const USERS_PER_PAGE = 20;

async function edgeFunctionErrorCode(invokeError) {
  const response = invokeError?.context;
  if (!response || typeof response.clone !== "function") return "";
  try {
    return String((await response.clone().json())?.error || "");
  } catch {
    return "";
  }
}

function editErrorMessage(code) {
  const messages = {
    valid_email_required: "올바른 이메일을 입력해 주세요.",
    email_too_long: "이메일이 너무 깁니다.",
    name_required: "이름을 입력해 주세요.",
    name_too_long: "이름이 너무 깁니다.",
    password_min_8: "새 비밀번호는 8자 이상이어야 합니다.",
    password_too_long: "새 비밀번호는 128자 이하여야 합니다.",
    protected_admin_credentials: "관리자 계정의 이메일과 비밀번호는 이 화면에서 변경할 수 없습니다.",
    reserved_admin_email: "관리자 권한용 이메일은 직원 계정에 지정할 수 없습니다.",
    user_exists: "이미 등록된 이메일입니다.",
    user_not_found: "해당 계정을 찾지 못했습니다. 목록을 새로고침해 주세요.",
    forbidden: "관리자 권한이 없습니다.",
  };
  return messages[code] || "직원 계정을 수정하지 못했습니다.";
}

function formatDateTime(value) {
  if (!value) return "로그인 기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "로그인 기록 확인 불가";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function AdminPage() {
  const [allowed, setAllowed] = useState(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bulkRows, setBulkRows] = useState([]);
  const [bulkFileName, setBulkFileName] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [fareRows, setFareRows] = useState([]);
  const [fareFileName, setFareFileName] = useState("");
  const [fareBusy, setFareBusy] = useState(false);
  const [fareMessage, setFareMessage] = useState("");
  const [fareError, setFareError] = useState("");
  const [managedUsers, setManagedUsers] = useState([]);
  const [userSearch, setUserSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [usersBusy, setUsersBusy] = useState(false);
  const [usersMessage, setUsersMessage] = useState("");
  const [usersError, setUsersError] = useState("");
  const [editingUserId, setEditingUserId] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editFullName, setEditFullName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  useEffect(() => {
    getSupabaseBrowserClient().auth.getUser().then(({ data, error: userError }) => {
      // This client check only controls the page UX. The invoked Edge Functions
      // remain responsible for authorizing every privileged operation.
      const isAdmin = !userError && hasAdminUiAccess(data.user);
      setAllowed(isAdmin);
      if (!isAdmin) setError("관리자 권한이 있는 계정으로 로그인해야 합니다.");
      else loadManagedUsers();
    });
  }, []);

  useEffect(() => {
    setUserPage(1);
    cancelEditingUser();
  }, [userSearch]);

  async function loadManagedUsers({ quiet = false } = {}) {
    setUsersBusy(true);
    setUsersError("");
    if (!quiet) setUsersMessage("");
    const { data, error: invokeError } = await getSupabaseBrowserClient().functions.invoke(
      "admin-manage-users",
      { body: { action: "list" } },
    );
    const code = data?.error || await edgeFunctionErrorCode(invokeError);
    if (invokeError || code) {
      setUsersError(code === "forbidden" ? "관리자 권한이 없습니다." : "직원 목록을 불러오지 못했습니다. 함수 배포 상태를 확인해 주세요.");
    } else {
      setManagedUsers(Array.isArray(data?.users) ? data.users : []);
      if (data?.truncated) setUsersMessage("처음 1,000개 계정만 표시하고 있습니다.");
    }
    setUsersBusy(false);
  }

  function startEditingUser(user) {
    setEditingUserId(user.id);
    setEditEmail(user.email);
    setEditFullName(user.fullName);
    setEditPassword("");
    setUsersMessage("");
    setUsersError("");
  }

  function cancelEditingUser() {
    setEditingUserId("");
    setEditEmail("");
    setEditFullName("");
    setEditPassword("");
  }

  async function saveManagedUser(event, user) {
    event.preventDefault();
    setEditBusy(true);
    setUsersMessage("");
    setUsersError("");
    const { data, error: invokeError } = await getSupabaseBrowserClient().functions.invoke(
      "admin-manage-users",
      {
        body: {
          action: "update",
          user: {
            id: user.id,
            email: editEmail.trim(),
            fullName: editFullName.trim(),
            password: editPassword,
          },
        },
      },
    );
    const code = data?.error || await edgeFunctionErrorCode(invokeError);
    if (invokeError || code) {
      setUsersError(editErrorMessage(code));
    } else if (data?.user) {
      setManagedUsers((current) => current.map((item) => item.id === data.user.id ? data.user : item));
      setUsersMessage(`${data.user.fullName || data.user.email} 계정 정보를 수정했습니다.${data.passwordChanged ? " 새 비밀번호도 적용했습니다." : ""}`);
      cancelEditingUser();
    }
    setEditBusy(false);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    const { data, error: invokeError } = await getSupabaseBrowserClient().functions.invoke("admin-create-user", {
      body: { email: email.trim(), fullName: fullName.trim(), password },
    });
    if (invokeError) {
      setError("계정 생성 요청에 실패했습니다. 관리자 로그인 상태를 확인해 주세요.");
    } else if (data?.error === "user_exists") {
      setError("이미 등록된 이메일입니다.");
    } else if (data?.error) {
      const messages = { valid_email_required: "올바른 이메일을 입력해 주세요.", password_min_8: "비밀번호는 8자 이상이어야 합니다.", name_required: "이름을 입력해 주세요.", forbidden: "관리자 권한이 없습니다." };
      setError(messages[data.error] || "계정을 만들지 못했습니다.");
    } else {
      setMessage(`${data?.user?.email || email} 계정을 만들었습니다. 이메일 확인 없이 바로 로그인할 수 있습니다.`);
      setEmail("");
      setFullName("");
      setPassword("");
      loadManagedUsers({ quiet: true });
    }
    setBusy(false);
  }

  async function readBulkFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setBulkMessage("");
    setBulkError("");
    setBulkRows([]);
    setBulkFileName(file?.name || "");
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "", raw: false });
      setBulkRows(parseStaffAccountRows(rows, { maxUsers: MAX_BULK_USERS }));
    } catch (bulkFileError) {
      setBulkFileName("");
      setBulkError(bulkFileError instanceof Error ? bulkFileError.message : "엑셀을 읽지 못했습니다.");
    }
  }

  async function submitBulk() {
    if (!bulkRows.length) return;
    setBulkBusy(true);
    setBulkMessage("");
    setBulkError("");
    const { data, error: invokeError } = await getSupabaseBrowserClient().functions.invoke("admin-create-user", { body: { users: bulkRows } });
    if (invokeError) {
      setBulkError("일괄 등록 요청에 실패했습니다. 관리자 로그인 상태를 확인해 주세요.");
    } else if (data?.error) {
      setBulkError(data.error === "bulk_limit" ? `한 번에 최대 ${MAX_BULK_USERS}명까지 등록할 수 있습니다.` : "엑셀 직원 등록을 처리하지 못했습니다.");
    } else {
      const created = data?.created?.length || 0;
      const duplicates = data?.duplicates?.length || 0;
      const failed = data?.failed?.length || 0;
      setBulkMessage(`엑셀 등록 완료: 새 계정 ${created}명 · 이미 등록된 계정 ${duplicates}명 · 실패 ${failed}명`);
      setBulkRows([]);
      setBulkFileName("");
      loadManagedUsers({ quiet: true });
    }
    setBulkBusy(false);
  }

  async function readFareFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setFareRows([]);
    setFareFileName(file?.name || "");
    setFareMessage("");
    setFareError("");
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
      setFareRows(parseFareCatalogRows(rows, { maxRoutes: MAX_FARE_ROWS }));
    } catch (fileError) {
      setFareFileName("");
      setFareError(fileError instanceof Error ? fileError.message : "운임 파일을 읽지 못했습니다.");
    }
  }

  async function submitFareCatalog() {
    if (!fareRows.length) return;
    setFareBusy(true);
    setFareMessage("");
    setFareError("");
    const { data, error: invokeError } = await getSupabaseBrowserClient().functions.invoke("admin-fare-catalog", { body: { presets: fareRows } });
    if (invokeError) setFareError(invokeError.message || "공용 운임 기준표 업로드에 실패했습니다. 관리자 로그인 상태와 함수 배포 상태를 확인하세요.");
    else if (data?.error) setFareError(data.error === "validation_failed" ? "운임 기준표 검증에 실패했습니다. 양식을 다시 확인하세요." : "공용 운임 기준표를 저장하지 못했습니다.");
    else {
      // 파일에서 빠진 노선은 서버가 지우지 않는다. 항상 0인 "제거" 수치는 알리지 않는다.
      setFareMessage(`공용 기준표 ${data.total}개 노선을 반영했습니다. 신규 ${data.created}개 · 수정 ${data.updated}개`);
      setFareRows([]);
      setFareFileName("");
    }
    setFareBusy(false);
  }

  if (allowed === null) return <main style={{ padding: 40 }}>관리자 권한을 확인하는 중…</main>;
  if (!allowed) return <main style={{ padding: 40 }}><p role="alert">{error}</p><a href="/signin">로그인 화면으로 이동</a></main>;

  const normalizedSearch = userSearch.trim().toLocaleLowerCase("ko-KR");
  const filteredUsers = managedUsers.filter((user) =>
    !normalizedSearch
    || user.email.toLocaleLowerCase("ko-KR").includes(normalizedSearch)
    || user.fullName.toLocaleLowerCase("ko-KR").includes(normalizedSearch)
  );
  const userPageCount = Math.max(1, Math.ceil(filteredUsers.length / USERS_PER_PAGE));
  const currentUserPage = Math.min(userPage, userPageCount);
  const visibleUsers = filteredUsers.slice((currentUserPage - 1) * USERS_PER_PAGE, currentUserPage * USERS_PER_PAGE);

  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 20, padding: 24, background: "#f4f6fa" }}>
      <form onSubmit={submit} style={{ width: "min(100%, 480px)", padding: 32, borderRadius: 18, background: "#fff", boxShadow: "0 14px 50px #1d2b4418" }}>
        <h1 style={{ margin: "0 0 8px" }}>직원 계정 만들기</h1>
        <p style={{ color: "#667085", lineHeight: 1.6 }}>{ADMIN_UI_CONFIG.fallbackEmail ? <>관리자 안내 계정: {ADMIN_UI_CONFIG.fallbackEmail}<br /></> : null}직원 이메일과 초기 비밀번호를 입력해 계정을 만들어 주세요.</p>
        <label style={{ display: "block", marginTop: 18, fontWeight: 700 }}>직원 이메일</label>
        <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" style={{ width: "100%", boxSizing: "border-box", margin: "8px 0 14px", padding: 13, border: "1px solid #ccd4e0", borderRadius: 8 }} />
        <label style={{ display: "block", fontWeight: 700 }}>직원 이름</label>
        <input required value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="off" style={{ width: "100%", boxSizing: "border-box", margin: "8px 0 14px", padding: 13, border: "1px solid #ccd4e0", borderRadius: 8 }} />
        <label style={{ display: "block", fontWeight: 700 }}>초기 비밀번호</label>
        <input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="8자 이상" style={{ width: "100%", boxSizing: "border-box", margin: "8px 0 18px", padding: 13, border: "1px solid #ccd4e0", borderRadius: 8 }} />
        <button disabled={busy} style={{ width: "100%", padding: 13, border: 0, borderRadius: 8, background: "#214b8e", color: "#fff", fontWeight: 700 }}>{busy ? "생성 중…" : "직원 계정 만들기"}</button>
        <a href="/travel" style={{ display: "block", marginTop: 16, textAlign: "center", color: "#315895" }}>출장 화면으로 돌아가기</a>
        {message ? <p style={{ color: "#315895", lineHeight: 1.6 }}>{message}</p> : null}
        {error ? <p role="alert" style={{ color: "#b42318", lineHeight: 1.6 }}>{error}</p> : null}
      </form>
      <section className={styles.userSection} aria-labelledby="managed-user-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="managed-user-heading">등록 직원 편집</h2>
            <p>직원의 이름·이메일을 수정하거나 새 비밀번호를 설정할 수 있습니다. 관리자 계정의 로그인 정보는 보호됩니다.</p>
          </div>
          <button type="button" className={styles.refreshButton} onClick={() => loadManagedUsers()} disabled={usersBusy || editBusy}>
            {usersBusy ? "불러오는 중…" : "목록 새로고침"}
          </button>
        </div>
        <label>
          <span style={{ display: "block", marginTop: 18, fontWeight: 700 }}>직원 검색</span>
          <input
            className={styles.searchInput}
            type="search"
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
            placeholder="이름 또는 이메일"
            autoComplete="off"
          />
        </label>
        <p className={styles.listSummary}>전체 {managedUsers.length}명 · 검색 결과 {filteredUsers.length}명 · {currentUserPage}/{userPageCount}쪽</p>
        {usersMessage ? <p className={styles.successMessage}>{usersMessage}</p> : null}
        {usersError ? <p role="alert" className={styles.errorMessage}>{usersError}</p> : null}
        {!usersBusy && !visibleUsers.length ? <p className={styles.emptyMessage}>조건에 맞는 직원 계정이 없습니다.</p> : null}
        <div className={styles.userList}>
          {visibleUsers.map((user) => {
            const editing = editingUserId === user.id;
            const credentialsLocked = user.isProtectedAdmin;
            return (
              <article className={styles.userCard} key={user.id}>
                <div className={styles.userOverview}>
                  <div className={styles.userIdentity}>
                    <div className={styles.userNameLine}>
                      <strong>{user.fullName || "이름 미등록"}</strong>
                      {user.isCurrentUser ? <span className={styles.badge}>현재 로그인</span> : null}
                      {user.isProtectedAdmin ? <span className={styles.badge}>관리자 보호</span> : null}
                    </div>
                    <p className={styles.userEmail}>{user.email}</p>
                    <p className={styles.userMeta}>최근 로그인: {formatDateTime(user.lastSignInAt)} · {user.emailConfirmed ? "이메일 확인됨" : "이메일 미확인"}</p>
                  </div>
                  <button type="button" className={styles.editButton} onClick={() => startEditingUser(user)} disabled={editBusy || (editingUserId && !editing)}>
                    {editing ? "편집 중" : "편집"}
                  </button>
                </div>
                {editing ? (
                  <form className={styles.editor} onSubmit={(event) => saveManagedUser(event, user)}>
                    <label>
                      이름
                      <input required maxLength={120} value={editFullName} onChange={(event) => setEditFullName(event.target.value)} autoComplete="off" />
                    </label>
                    <label>
                      이메일
                      <input required maxLength={240} type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} disabled={credentialsLocked} autoComplete="off" />
                    </label>
                    <label className={styles.passwordField}>
                      새 비밀번호
                      <input minLength={8} maxLength={128} type="password" value={editPassword} onChange={(event) => setEditPassword(event.target.value)} disabled={credentialsLocked} autoComplete="new-password" placeholder={credentialsLocked ? "관리자 계정은 변경할 수 없습니다" : "변경할 때만 8자 이상 입력"} />
                    </label>
                    <p className={styles.editorHint}>{credentialsLocked ? "관리자 계정은 이름만 수정할 수 있습니다." : "새 비밀번호를 비워 두면 기존 비밀번호가 유지됩니다. 비밀번호는 화면에 저장하거나 다시 표시하지 않습니다."}</p>
                    <div className={styles.editorActions}>
                      <button type="button" className={styles.cancelButton} onClick={cancelEditingUser} disabled={editBusy}>취소</button>
                      <button type="submit" className={styles.saveButton} disabled={editBusy}>{editBusy ? "저장 중…" : "변경 저장"}</button>
                    </div>
                  </form>
                ) : null}
              </article>
            );
          })}
        </div>
        {filteredUsers.length > USERS_PER_PAGE ? (
          <nav className={styles.userPagination} aria-label="직원 계정 목록 페이지">
            <button type="button" onClick={() => { cancelEditingUser(); setUserPage((page) => Math.max(1, page - 1)); }} disabled={currentUserPage <= 1 || editBusy}>이전</button>
            <span>{currentUserPage} / {userPageCount}</span>
            <button type="button" onClick={() => { cancelEditingUser(); setUserPage((page) => Math.min(userPageCount, page + 1)); }} disabled={currentUserPage >= userPageCount || editBusy}>다음</button>
          </nav>
        ) : null}
      </section>
      <section style={{ width: "min(100%, 720px)", boxSizing: "border-box", padding: 32, borderRadius: 18, background: "#fff", boxShadow: "0 14px 50px #1d2b4418" }}>
        <h2 style={{ margin: 0 }}>엑셀로 직원 일괄 등록</h2>
        <p style={{ color: "#667085", lineHeight: 1.6 }}>양식에 이메일·이름·초기 비밀번호를 한 줄씩 입력한 뒤 업로드하세요. 한 번에 최대 {MAX_BULK_USERS}명까지 등록할 수 있습니다.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
          <a href="/templates/staff-account-import-template.xlsx" download style={{ display: "inline-flex", alignItems: "center", padding: "11px 14px", border: "1px solid #b9c7dc", borderRadius: 8, background: "#f5f8fc", color: "#214b8e", fontWeight: 700, textDecoration: "none" }}>엑셀 양식 다운로드</a>
          <label style={{ display: "inline-flex", alignItems: "center", padding: "11px 14px", borderRadius: 8, background: "#214b8e", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
            엑셀 파일 선택
            <input type="file" accept=".xlsx,.xls,.csv" onChange={readBulkFile} hidden />
          </label>
        </div>
        {bulkFileName ? <p style={{ margin: "14px 0 0", color: "#475467" }}>선택한 파일: {bulkFileName} · {bulkRows.length}명 확인</p> : null}
        {bulkRows.length ? <>
          <div style={{ maxHeight: 190, overflow: "auto", marginTop: 14, border: "1px solid #e4e7ec", borderRadius: 9 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><thead><tr style={{ background: "#f8fafc" }}><th style={{ padding: 9, textAlign: "left" }}>행</th><th style={{ padding: 9, textAlign: "left" }}>이메일</th><th style={{ padding: 9, textAlign: "left" }}>이름</th></tr></thead><tbody>{bulkRows.map((row) => <tr key={`${row.email}-${row.rowNumber}`}><td style={{ padding: 9, borderTop: "1px solid #eef1f5" }}>{row.rowNumber}</td><td style={{ padding: 9, borderTop: "1px solid #eef1f5" }}>{row.email}</td><td style={{ padding: 9, borderTop: "1px solid #eef1f5" }}>{row.fullName}</td></tr>)}</tbody></table>
          </div>
          <button type="button" onClick={submitBulk} disabled={bulkBusy} style={{ width: "100%", marginTop: 16, padding: 13, border: 0, borderRadius: 8, background: "#16805b", color: "#fff", fontWeight: 700 }}>{bulkBusy ? "일괄 등록 중…" : `${bulkRows.length}명 직원 계정 등록`}</button>
        </> : null}
        {bulkMessage ? <p style={{ color: "#16704f", lineHeight: 1.6 }}>{bulkMessage}</p> : null}
        {bulkError ? <p role="alert" style={{ color: "#b42318", lineHeight: 1.6 }}>{bulkError}</p> : null}
      </section>
      <section id="fare-settings" style={{ width: "min(100%, 720px)", boxSizing: "border-box", padding: 32, borderRadius: 18, background: "#fff", boxShadow: "0 14px 50px #1d2b4418" }}>
        <p style={{ margin: "0 0 6px", color: "#2359ad", fontSize: 13, fontWeight: 800, letterSpacing: ".08em" }}>운임 설정</p>
        <h2 style={{ margin: 0 }}>공용 대중교통 운임 기준표</h2>
        <p style={{ color: "#667085", lineHeight: 1.6 }}>관리자가 올린 노선만 전 직원의 자동 운임 계산에 적용됩니다. 직원 화면에서는 기준표를 조회·수정할 수 없으며, 같은 노선을 다시 올리면 새 금액으로 교체되고 파일에 빠진 기존 노선은 안전하게 보존됩니다.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
          <a href="/templates/travel-fare-import-template.xlsx" download style={{ display: "inline-flex", alignItems: "center", padding: "11px 14px", border: "1px solid #b9c7dc", borderRadius: 8, background: "#f5f8fc", color: "#214b8e", fontWeight: 700, textDecoration: "none" }}>공용 운임 양식 다운로드</a>
          <label style={{ display: "inline-flex", alignItems: "center", padding: "11px 14px", borderRadius: 8, background: "#214b8e", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
            공용 운임 파일 선택
            <input type="file" accept=".xlsx,.xls,.csv" onChange={readFareFile} hidden />
          </label>
        </div>
        {fareFileName ? <p style={{ margin: "14px 0 0", color: "#475467" }}>선택한 파일: {fareFileName} · {fareRows.length}개 노선 확인</p> : null}
        {fareRows.length ? <>
          <div style={{ maxHeight: 220, overflow: "auto", marginTop: 14, border: "1px solid #e4e7ec", borderRadius: 9 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><thead><tr style={{ background: "#f8fafc" }}><th style={{ padding: 9, textAlign: "left" }}>출발지</th><th style={{ padding: 9, textAlign: "left" }}>도착지</th><th style={{ padding: 9, textAlign: "right" }}>가는 길</th><th style={{ padding: 9, textAlign: "right" }}>오는 길</th></tr></thead><tbody>{fareRows.slice(0, 100).map((row) => <tr key={`${row.origin}-${row.destination}`}><td style={{ padding: 9, borderTop: "1px solid #eef1f5" }}>{row.origin}</td><td style={{ padding: 9, borderTop: "1px solid #eef1f5" }}>{row.destination}</td><td style={{ padding: 9, borderTop: "1px solid #eef1f5", textAlign: "right" }}>{row.outboundFare.toLocaleString()}원</td><td style={{ padding: 9, borderTop: "1px solid #eef1f5", textAlign: "right" }}>{row.returnFare.toLocaleString()}원</td></tr>)}</tbody></table>
          </div>
          <button type="button" onClick={submitFareCatalog} disabled={fareBusy} style={{ width: "100%", marginTop: 16, padding: 13, border: 0, borderRadius: 8, background: "#16805b", color: "#fff", fontWeight: 700 }}>{fareBusy ? "공용 기준표 업로드 중…" : `${fareRows.length}개 노선을 공용 기준표로 반영`}</button>
        </> : null}
        {fareMessage ? <p style={{ color: "#16704f", lineHeight: 1.6 }}>{fareMessage}</p> : null}
        {fareError ? <p role="alert" style={{ color: "#b42318", lineHeight: 1.6 }}>{fareError}</p> : null}
      </section>
    </main>
  );
}
