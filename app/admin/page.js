"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { parseStaffAccountRows } from "@/lib/staff-account-import";
import { ADMIN_UI_CONFIG, hasAdminUiAccess } from "@/config/admin";

const MAX_BULK_USERS = 100;
const MAX_FARE_ROWS = 500;

function normalizeHeader(value) {
  return String(value ?? "").toLowerCase().replace(/[\s_\-()]/g, "");
}

function parseFareRows(rows) {
  const expected = ["출발지", "도착지", "가는길운임", "오는길운임"];
  const headerIndex = rows.findIndex((row) => expected.every((header, index) => normalizeHeader(row?.[index]) === normalizeHeader(header)));
  if (headerIndex < 0) throw new Error("운임 양식의 열은 출발지, 도착지, 가는 길 운임, 오는 길 운임이어야 합니다.");
  const seen = new Set();
  const parsed = [];
  const errors = [];
  const toFare = (value) => {
    if (typeof value === "number") return value;
    const text = String(value ?? "").replace(/[₩원,\s]/gi, "");
    return text ? Number(text) : 0;
  };
  rows.slice(headerIndex + 1).forEach((row, index) => {
    const rowNumber = index + headerIndex + 2;
    const origin = String(row?.[0] ?? "").replace(/\s+/g, " ").trim();
    const destination = String(row?.[1] ?? "").replace(/\s+/g, " ").trim();
    const outboundFare = toFare(row?.[2]);
    const returnFare = toFare(row?.[3]);
    if (!origin && !destination && !String(row?.[2] ?? "") && !String(row?.[3] ?? "")) return;
    const key = `${origin.toLocaleLowerCase("ko-KR")}\u0000${destination.toLocaleLowerCase("ko-KR")}`;
    if (!origin || !destination) errors.push(`${rowNumber}행: 출발지와 도착지를 모두 입력하세요.`);
    else if (origin.toLocaleLowerCase("ko-KR") === destination.toLocaleLowerCase("ko-KR")) errors.push(`${rowNumber}행: 출발지와 도착지는 달라야 합니다.`);
    else if (!Number.isSafeInteger(outboundFare) || outboundFare < 0 || outboundFare > 10000000 || !Number.isSafeInteger(returnFare) || returnFare < 0 || returnFare > 10000000) errors.push(`${rowNumber}행: 운임은 0~10,000,000원 정수로 입력하세요.`);
    else if (!outboundFare && !returnFare) errors.push(`${rowNumber}행: 가는 길 또는 오는 길 운임을 입력하세요.`);
    else if (seen.has(key)) errors.push(`${rowNumber}행: 같은 출발지·도착지가 중복됩니다.`);
    else { seen.add(key); parsed.push({ origin, destination, outboundFare, returnFare, rowNumber }); }
  });
  if (errors.length) throw new Error(errors.slice(0, 12).join(" · "));
  if (parsed.length > MAX_FARE_ROWS) throw new Error(`한 번에 ${MAX_FARE_ROWS}개 노선까지만 업로드할 수 있습니다.`);
  if (!parsed.length) throw new Error("업로드할 운임 노선이 없습니다.");
  return parsed;
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

  useEffect(() => {
    getSupabaseBrowserClient().auth.getUser().then(({ data, error: userError }) => {
      // This client check only controls the page UX. The invoked Edge Functions
      // remain responsible for authorizing every privileged operation.
      const isAdmin = !userError && hasAdminUiAccess(data.user);
      setAllowed(isAdmin);
      if (!isAdmin) setError("관리자 권한이 있는 계정으로 로그인해야 합니다.");
    });
  }, []);

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
      setFareRows(parseFareRows(rows));
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
      setFareMessage(`공용 기준표 ${data.total}개 노선을 반영했습니다. 신규 ${data.created}개 · 수정 ${data.updated}개 · 제거 ${data.removed}개`);
      setFareRows([]);
      setFareFileName("");
    }
    setFareBusy(false);
  }

  if (allowed === null) return <main style={{ padding: 40 }}>관리자 권한을 확인하는 중…</main>;
  if (!allowed) return <main style={{ padding: 40 }}><p role="alert">{error}</p><a href="/signin">로그인 화면으로 이동</a></main>;

  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 20, padding: 24, background: "#f4f6fa" }}>
      <form onSubmit={submit} style={{ width: "min(100%, 480px)", padding: 32, borderRadius: 18, background: "#fff", boxShadow: "0 14px 50px #1d2b4418" }}>
        <h1 style={{ margin: "0 0 8px" }}>직원 계정 관리</h1>
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
      <section style={{ width: "min(100%, 720px)", boxSizing: "border-box", padding: 32, borderRadius: 18, background: "#fff", boxShadow: "0 14px 50px #1d2b4418" }}>
        <h2 style={{ margin: 0 }}>공용 대중교통 운임 기준표</h2>
        <p style={{ color: "#667085", lineHeight: 1.6 }}>여기 업로드한 노선은 모든 직원에게 동일하게 제공되며, 개인이 저장한 같은 노선보다 우선 적용됩니다. 같은 노선은 새 금액으로 교체되고, 파일에 빠진 기존 노선은 안전하게 보존됩니다.</p>
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
