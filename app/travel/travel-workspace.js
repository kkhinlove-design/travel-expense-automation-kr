"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LOCAL_AI_CONFIG } from "@/config/local-ai";
import { APP_FOOTER, ORGANIZATION_CONFIG } from "@/config/organization";
import { TRAVEL_POLICY } from "@/config/travel-policy";
import { buildTravelWorkbook, travelWorkbookFilename } from "@/lib/travel-excel";
import { findAutomaticFareMatch } from "@/lib/travel-fare-matching";
import { extractApprovedTravelHwpx, extractApprovedTravelPdf } from "@/lib/travel-parser";
import {
  buildRuleBasedTravelReport,
  choosePreferredOllamaModel,
  draftTravelReportLocally,
  draftTravelReportWithOllama,
  listOllamaModels,
  supportsLocalReportAI,
} from "@/lib/local-report-ai";
import {
  calculateTripExpense,
  fareGradeForDocument,
  LABOR_MEAL_REGIONS,
  LODGING_CAPS,
  normalizeTripWaypoints,
  PROJECT_TYPES,
  TRANSPORT_TYPES,
  tripAmountIssues,
  tripDateValidationError,
  tripRequiredInformationValidationError,
  tripRoutePoints,
  tripRouteValidationError,
  tripTransportFares,
} from "@/lib/travel-rules";
import { initialReportApprovalLine, initialTripOrigin, reportApprovalLineForDocument } from "@/lib/travel-user-preferences";
import styles from "./travel.module.css";

const KRW = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const CHUNK_RELOAD_KEY = "travel:chunk-reload-at";
const CHUNK_RELOAD_COOLDOWN_MS = 60_000;
const MAX_FARE = 10_000_000;
const MAX_SOURCE_FILE_SIZE = 4 * 1024 * 1024;
const MAX_REPORT_CHARACTERS = 3_200;
const MAX_REPORT_VISUAL_LINES = 60;

function fareValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(MAX_FARE, Math.max(0, Math.round(numeric)));
}

function isPdfFile(file) {
  return Boolean(file && (String(file.name || "").toLowerCase().endsWith(".pdf") || file.type === "application/pdf"));
}

function isHwpxFile(file) {
  return Boolean(file && String(file.name || "").toLowerCase().endsWith(".hwpx"));
}

function parsedTravelMissing(parsed) {
  const missing = [];
  if (!parsed.department) missing.push("부서");
  if (!parsed.position) missing.push("직급/직위");
  if (!parsed.employeeName) missing.push("성명");
  if (!parsed.purpose) missing.push("출장목적");
  if (!parsed.startAt || !parsed.endAt) missing.push("출장기간");
  if (!parsed.destination) missing.push("출장지");
  return missing;
}

function mergeParsedTravelDocuments(pdfParsed, hwpxParsed) {
  const preferred = hwpxParsed || pdfParsed;
  const fallback = hwpxParsed ? pdfParsed : null;
  if (!preferred) return null;
  const value = (key) => preferred[key] || fallback?.[key] || "";
  const preferredParticipants = preferred.participants?.filter((participant) => participant.employeeName);
  const fallbackParticipants = fallback?.participants?.filter((participant) => participant.employeeName);
  const result = {
    ...fallback,
    ...preferred,
    documentNumber: value("documentNumber"),
    documentTitle: value("documentTitle"),
    department: value("department"),
    position: value("position"),
    employeeName: value("employeeName"),
    purpose: value("purpose"),
    destination: value("destination"),
    startAt: value("startAt"),
    endAt: value("endAt"),
    transportType: preferred.transportType || fallback?.transportType || "personal",
    parsedText: preferred.parsedText || fallback?.parsedText || "",
  };
  const selectedParticipants = preferredParticipants?.length ? preferredParticipants : (fallbackParticipants?.length ? fallbackParticipants : []);
  result.participants = selectedParticipants.map((participant, index) => {
    const fallbackParticipant = fallbackParticipants?.find((item) => item.employeeName === participant.employeeName)
      || fallbackParticipants?.[index];
    return {
      ...fallbackParticipant,
      ...participant,
      department: participant.department || fallbackParticipant?.department || result.department,
      position: participant.position || fallbackParticipant?.position || result.position,
      employeeName: participant.employeeName || fallbackParticipant?.employeeName || (index === 0 ? result.employeeName : ""),
      purpose: participant.purpose || fallbackParticipant?.purpose || result.purpose,
    };
  });
  result.missing = parsedTravelMissing(result);
  return result;
}

function normalizedSourceIdentity(value) {
  return String(value || "").normalize("NFKC").replace(/[^0-9a-z가-힣]/gi, "").toLocaleLowerCase("ko-KR");
}

function sourcePairValidationError(pdfParsed, hwpxParsed) {
  if (!pdfParsed || !hwpxParsed) return "";
  const pdfNumber = normalizedSourceIdentity(pdfParsed.documentNumber);
  const hwpxNumber = normalizedSourceIdentity(hwpxParsed.documentNumber);
  if (pdfNumber && hwpxNumber) {
    return pdfNumber === hwpxNumber
      ? ""
      : `PDF 문서번호(${pdfParsed.documentNumber})와 HWPX 문서번호(${hwpxParsed.documentNumber})가 다릅니다. 같은 출장의 원본으로 교체해 주세요.`;
  }

  const participantNames = (parsed) => [...new Set([
    parsed.employeeName,
    ...(parsed.participants || []).map((participant) => participant.employeeName),
  ].map(normalizedSourceIdentity).filter(Boolean))];
  const pdfNames = participantNames(pdfParsed);
  const hwpxNames = participantNames(hwpxParsed);
  const pdfDate = String(pdfParsed.startAt || "").slice(0, 10);
  const hwpxDate = String(hwpxParsed.startAt || "").slice(0, 10);
  const hasSharedParticipant = pdfNames.some((name) => hwpxNames.includes(name));
  if (pdfNames.length && hwpxNames.length && !hasSharedParticipant) return "PDF와 HWPX의 출장자 이름이 다릅니다. 같은 출장의 원본으로 교체해 주세요.";
  if (pdfDate && hwpxDate && pdfDate !== hwpxDate) return "PDF와 HWPX의 출장일이 다릅니다. 같은 출장의 원본으로 교체해 주세요.";
  if (hasSharedParticipant && pdfDate && hwpxDate) return "";
  return "PDF와 HWPX의 같은 출장 여부를 자동 확인하지 못했습니다. 문서번호 또는 출장자·출장일을 확인할 수 있는 원본으로 다시 올려주세요.";
}

function newParticipant(values = {}) {
  return {
    id: values.id || crypto.randomUUID(),
    department: values.department || "",
    position: values.position || "",
    employeeName: values.employeeName || "",
    purpose: values.purpose || "",
    transportClaimant: Boolean(values.transportClaimant),
    lodgingActual: Number(values.lodgingActual) || 0,
    deduction: Number(values.deduction) || 0,
    mealsProvided: {
      breakfast: Boolean(values.mealsProvided?.breakfast),
      lunch: Boolean(values.mealsProvided?.lunch),
      dinner: Boolean(values.mealsProvided?.dinner),
    },
  };
}

function blankTrip(user, defaultOrigin = "", defaultReportApprovalLine = ORGANIZATION_CONFIG.defaultReportApprovalLine) {
  const participant = newParticipant({
    employeeName: user?.displayName?.includes("@") ? "" : user?.displayName ?? "",
    transportClaimant: true,
  });
  const preferredOrigin = initialTripOrigin(defaultOrigin);
  return {
    id: crypto.randomUUID(),
    documentNumber: "",
    documentTitle: "",
    department: "",
    position: "",
    employeeName: participant.employeeName,
    participants: [participant],
    reporterParticipantId: participant.id,
    purpose: "",
    destination: "",
    transportDestination: "",
    origin: preferredOrigin,
    waypoints: [],
    startAt: "",
    endAt: "",
    transportType: "personal",
    projectType: "labor",
    laborMealRegion: "inProvince",
    tripScope: "domestic",
    workshopStay: false,
    lodgingRegion: "other",
    outboundTransportActual: 0,
    returnTransportActual: 0,
    transportActual: 0,
    lodgingActual: 0,
    deduction: 0,
    mealsProvided: { breakfast: false, lunch: false, dinner: false },
    reportNotes: "",
    reportContent: "",
    reportContentSource: "empty",
    reportBasisKey: "",
    reportNeedsReview: false,
    reportApprovalLine: initialReportApprovalLine(defaultReportApprovalLine),
    parsedText: "",
    missing: [],
  };
}

function tripWithFarePreset(current, item) {
  const outbound = fareValue(item.outbound_fare ?? item.outboundFare);
  const returning = fareValue(item.return_fare ?? item.returnFare);
  const appliedAt = new Date().toISOString();
  const grade = current.transportType === "personal" ? "인정 운임" : "수동 운임";
  const outboundSource = {
    provider: "저장된 대중교통 운임",
    sourceType: "preset",
    mode: "public",
    departure: item.origin,
    arrival: item.destination,
    grade,
    oneWayFare: outbound,
    retrievedAt: appliedAt,
  };
  const returnSource = {
    ...outboundSource,
    departure: item.destination,
    arrival: item.origin,
    oneWayFare: returning,
  };
  return {
    ...current,
    transportDestination: current.destination,
    waypoints: [],
    outboundTransportActual: outbound,
    returnTransportActual: returning,
    transportActual: outbound + returning,
    fareSource: outboundSource,
    fareSources: { outbound: outboundSource, return: returnSource },
  };
}

// 숫자로 읽히지 않는 값을 0원으로 그리면 잘못된 금액이 화면에도 인쇄물에도
// 그대로 찍힌다. 확정 전에 걸리도록 눈에 띄게 표시한다.
const UNREADABLE_AMOUNT = "확인 필요";

function money(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return UNREADABLE_AMOUNT;
  return `${KRW.format(Math.round(numeric))}원`;
}

function reportLayoutMetrics(content) {
  const lines = String(content || "").split(/\r?\n/);
  const visualLines = lines.reduce((total, line) => total + Math.max(1, Math.ceil([...line].length / 62)), 0);
  return {
    characters: [...String(content || "")].length,
    visualLines,
  };
}

function reportDocumentError(trip) {
  const content = String(trip?.reportContent || buildRuleBasedTravelReport(trip));
  const metrics = reportLayoutMetrics(content);
  if (metrics.characters > MAX_REPORT_CHARACTERS || metrics.visualLines > MAX_REPORT_VISUAL_LINES) {
    return `출장내용이 A4 한 쪽 범위를 넘습니다. ${MAX_REPORT_CHARACTERS.toLocaleString("ko-KR")}자·약 ${MAX_REPORT_VISUAL_LINES}줄 이내로 줄여 주세요.`;
  }
  return "";
}

function reportBasisKey(trip) {
  const participants = (Array.isArray(trip?.participants) ? trip.participants : [])
    .map((participant) => [participant.employeeName, participant.department, participant.position]
      .map((value) => String(value || "").replace(/\s+/g, " ").trim()));
  return JSON.stringify({
    route: tripRoutePoints(trip),
    destination: String(trip?.destination || "").replace(/\s+/g, " ").trim(),
    startAt: String(trip?.startAt || ""),
    endAt: String(trip?.endAt || ""),
    purpose: String(trip?.purpose || "").replace(/\s+/g, " ").trim(),
    notes: String(trip?.reportNotes || "").trim(),
    participants,
  });
}

function reportContentSource(trip) {
  if (trip?.reportContentSource) return trip.reportContentSource;
  if (!String(trip?.reportContent || "").trim()) return "empty";
  return trip.reportContent === buildRuleBasedTravelReport(trip) ? "rule" : "manual";
}

function updateReportForBasisChange(current, next) {
  const source = reportContentSource(current);
  const currentBasis = current.reportBasisKey || reportBasisKey(current);
  const nextBasis = reportBasisKey(next);
  if (source === "rule") {
    return {
      ...next,
      reportContent: buildRuleBasedTravelReport(next),
      reportContentSource: "rule",
      reportBasisKey: nextBasis,
      reportNeedsReview: false,
    };
  }
  const basisChanged = currentBasis !== nextBasis;
  return {
    ...next,
    reportContentSource: source,
    reportBasisKey: nextBasis,
    reportNeedsReview: Boolean(current.reportNeedsReview
      || (basisChanged && ["ai", "manual"].includes(source) && String(current.reportContent || "").trim())),
  };
}

function isManualFareSource(source) {
  return source?.sourceType === "preset"
    || /수동|직접 입력|저장된 대중교통 운임/.test(String(source?.provider || ""));
}

function dateKorean(value) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${String(date.getDate()).padStart(2, "0")}일`;
}

function dateShort(value) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return `${String(date.getMonth() + 1).padStart(2, "0")}월 ${String(date.getDate()).padStart(2, "0")}일`;
}

function weekday(value) {
  if (!value) return "";
  return ["일", "월", "화", "수", "목", "금", "토"][new Date(`${String(value).slice(0, 10)}T00:00:00`).getDay()];
}

function timeOnly(value) {
  return String(value ?? "").slice(11, 16);
}

function destinationShort(value) {
  return String(value ?? "").replace(/\([^)]*\)/g, "").trim();
}

function routeWaypointText(trip, direction = "outbound") {
  const waypoints = normalizeTripWaypoints(trip);
  const ordered = direction === "return" ? [...waypoints].reverse() : waypoints;
  return ordered.join(" → ") || "-";
}

function routeArrivalText(trip, direction = "outbound") {
  return tripRoutePoints(trip, direction).at(-1) || "-";
}

function routeDepartureText(trip, direction = "outbound") {
  return tripRoutePoints(trip, direction)[0] || "-";
}

function participantTransportFares(trip, item) {
  return item.participant.transportClaimant ? tripTransportFares(trip) : { outbound: 0, return: 0, total: 0 };
}

function selectZeroNumber(event) {
  if (Number(event.currentTarget.value) === 0) event.currentTarget.select();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function Field({ label, children, hint, wide = false }) {
  return (
    <label className={wide ? styles.fieldWide : styles.field}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function AmountCard({ label, value, note, accent = false }) {
  return (
    <article className={`${styles.amountCard} ${accent ? styles.amountCardAccent : ""}`}>
      <span>{label}</span>
      <strong>{money(value)}</strong>
      <small>{note}</small>
    </article>
  );
}

function groupTotals(items) {
  return items.reduce((total, item) => ({
    transport: total.transport + item.transport,
    perDiem: total.perDiem + item.perDiem,
    lodging: total.lodging + item.lodging,
    meal: total.meal + item.meal,
    deduction: total.deduction + item.deduction,
    total: total.total + item.total,
  }), { transport: 0, perDiem: 0, lodging: 0, meal: 0, deduction: 0, total: 0 });
}

function ParticipantApplication({ trip, item, transportLabel, today }) {
  const participant = item.participant;
  const provided = participant.mealsProvided ?? {};
  const fares = participantTransportFares(trip, item);
  const hasDirectionalSources = Boolean(trip.fareSources?.outbound || trip.fareSources?.return);
  const outboundGrade = participant.transportClaimant ? fareGradeForDocument(trip.fareSources?.outbound?.grade || (!hasDirectionalSources ? trip.fareSource?.grade : null)) : "동승";
  const returnGrade = participant.transportClaimant ? fareGradeForDocument(trip.fareSources?.return?.grade || (!hasDirectionalSources ? trip.fareSource?.grade : null)) : "동승";
  return (
    <article className={styles.a4Portrait}>
      <h1>여비지급신청서</h1>
      <table className={`${styles.formTable} ${styles.applicationInfoTable}`}><colgroup>{Array.from({ length: 7 }, (_, index) => <col key={index} />)}</colgroup><tbody>
        <tr><th>부서</th><td colSpan="2">{participant.department}</td><th>직급<br />(직위)</th><td>{participant.position}</td><th>성명</th><td>{participant.employeeName}</td></tr>
        <tr><th rowSpan="2">출장<br />일정</th><th>일시</th><td colSpan="5">{dateKorean(trip.startAt)} ({weekday(trip.startAt)})　{item.days}일간</td></tr>
        <tr><th>장소</th><td colSpan="5">{destinationShort(trip.destination)}{normalizeTripWaypoints(trip).length ? ` · 경유 ${routeWaypointText(trip)}` : ""}　- {participant.purpose || trip.purpose}</td></tr>
        <tr><th>숙박비</th><th>실제소요액</th><td>{money(item.lodging)}</td><th>상한</th><td colSpan="3">{money(LODGING_CAPS[trip.lodgingRegion] ?? LODGING_CAPS.other)} / 박</td></tr>
        <tr><th>식비</th><th>조식제공</th><td>{provided.breakfast ? "○" : "×"}</td><th>중식제공</th><td>{provided.lunch ? "○" : "×"}</td><th>석식제공</th><td>{provided.dinner ? "○" : "×"}</td></tr>
      </tbody></table>
      <table className={`${styles.formTable} ${styles.routeTable}`}><thead><tr><th>운임</th><th>일자</th><th>교통편</th><th>출발지</th><th>도착지</th><th>등급</th><th>금액</th></tr></thead><tbody>
        <tr><th rowSpan="3">운임</th><td>{dateShort(trip.startAt)}</td><td>{transportLabel}</td><td>{routeDepartureText(trip)}</td><td>{routeArrivalText(trip)}</td><td>{outboundGrade}</td><td>{money(fares.outbound)}</td></tr>
        <tr><td>{dateShort(trip.endAt)}</td><td>{transportLabel}</td><td>{routeDepartureText(trip, "return")}</td><td>{routeArrivalText(trip, "return")}</td><td>{returnGrade}</td><td>{money(fares.return)}</td></tr>
        <tr><td colSpan="5" className={styles.totalLabel}>계</td><td>{money(item.transport)}</td></tr>
      </tbody></table>
      <div className={styles.claimText}>
        <p>{TRAVEL_POLICY.legalBasisText}</p>
        <p>첨부 1. 증빙 영수증 1부　2. 유류비 지급신청 기준 1부(해당하는 경우)</p>
        <p className={styles.center}>{dateKorean(today)}</p>
        <p className={styles.signature}>신청자　{participant.employeeName}　(인)</p>
        <p className={styles.formNote}>※ 동반 출장일 경우에도 각각 작성</p>
      </div>
    </article>
  );
}

function ExpenseStatement({ trip, items, expense, transportLabel }) {
  const total = groupTotals(items);
  const fares = total.transport ? tripTransportFares(trip) : { outbound: 0, return: 0, total: 0 };
  return (
    <article className={styles.a4Landscape}>
      <h1>여 비 지 출 명 세 서</h1>
      <table className={styles.expenseTable}><thead><tr><th>부서명</th><th>직위</th><th>성명</th><th>출장지</th><th>교통수단</th><th>일수</th><th>야수</th><th>운임</th><th>일비</th><th>숙박료</th><th>식비</th><th>감액</th><th>지급액</th></tr></thead><tbody>
        {items.map((item) => <tr key={item.participant.id}><td>{item.participant.department}</td><td>{item.participant.position}</td><td>{item.participant.employeeName}</td><td>{destinationShort(trip.destination)}</td><td>{transportLabel}</td><td>{item.days}</td><td>{item.nights}</td><td>{money(item.transport)}</td><td>{money(item.perDiem)}</td><td>{money(item.lodging)}</td><td>{money(item.meal)}</td><td>{money(item.deduction)}</td><td><strong>{money(item.total)}</strong></td></tr>)}
        {Array.from({ length: Math.max(0, 5 - items.length) }, (_, index) => <tr className={styles.blankExpenseRow} key={`blank-${index}`}><td colSpan="13" /></tr>)}
      </tbody></table>
      <table className={styles.expenseTable}><thead><tr><th colSpan="6">출장명세</th><th colSpan="7">지출명세</th></tr><tr><th>일자</th><th>출발지</th><th>경유지</th><th>도착지</th><th>요금</th><th>일수</th><th>구분</th><th>기준</th><th>단가</th><th>전액</th><th>감액</th><th colSpan="2">지급액</th></tr></thead><tbody>
        <tr><td>{dateShort(trip.startAt)}</td><td>{routeDepartureText(trip)}</td><td>{routeWaypointText(trip)}</td><td>{routeArrivalText(trip)}</td><td>{money(fares.outbound)}</td><td>{expense.days}</td><td>운임</td><td>{transportLabel}</td><td>{money(total.transport)}</td><td>{money(total.transport)}</td><td>-</td><td colSpan="2">{money(total.transport)}</td></tr>
        <tr><td>{dateShort(trip.endAt)}</td><td>{routeDepartureText(trip, "return")}</td><td>{routeWaypointText(trip, "return")}</td><td>{routeArrivalText(trip, "return")}</td><td>{money(fares.return)}</td><td>{expense.days}</td><td>일비</td><td>{items.length}명 × {expense.days}일</td><td>{money(total.perDiem / Math.max(1, items.length * expense.days))}</td><td>{money(total.perDiem)}</td><td>-</td><td colSpan="2">{money(total.perDiem)}</td></tr>
        <tr><td colSpan="6" rowSpan="3" /><td>숙박료</td><td>{items.length}명 · {expense.nights}박</td><td>{money(total.lodging / Math.max(1, items.length * expense.nights))}</td><td>{money(total.lodging)}</td><td>-</td><td colSpan="2">{money(total.lodging)}</td></tr>
        <tr><td>식비</td><td>{items.length}명 × {expense.days}일</td><td>{money(total.meal / Math.max(1, items.length * expense.days))}</td><td>{money(total.meal)}</td><td>-</td><td colSpan="2">{money(total.meal)}</td></tr>
        <tr><td>준비비</td><td>해당없음</td><td>-</td><td>-</td><td>{money(total.deduction)}</td><td colSpan="2">-</td></tr>
        <tr><td colSpan="9" className={styles.totalLabel}>합계</td><td colSpan="4"><strong>{money(total.total)}</strong></td></tr>
      </tbody></table>
    </article>
  );
}

function PrintBundle({ trip, expense }) {
  const transportLabel = trip.transportType === "corporate" ? "법인차" : trip.transportType === "personal" ? "개인차" : "대중교통";
  const reportLines = String(trip.reportContent || buildRuleBasedTravelReport(trip)).split(/\r?\n/);
  const reportMetrics = reportLayoutMetrics(reportLines.join("\n"));
  const reportDensityClass = reportMetrics.characters > 2_400 || reportMetrics.visualLines > 42
    ? styles.reportBodyUltraDense
    : reportMetrics.characters > 1_600 || reportMetrics.visualLines > 32
      ? styles.reportBodyExtraDense
      : reportMetrics.characters > 1_000 || reportMetrics.visualLines > 24
        ? styles.reportBodyDense
        : reportMetrics.characters > 600 || reportMetrics.visualLines > 16
          ? styles.reportBodyCompact
          : "";
  const today = new Date().toISOString().slice(0, 10);
  const participantExpenses = expense.participantExpenses ?? [];
  const expenseGroups = [];
  for (let index = 0; index < participantExpenses.length; index += 5) expenseGroups.push(participantExpenses.slice(index, index + 5));
  const reporter = participantExpenses.find((item) => item.participant.id === trip.reporterParticipantId)?.participant ?? participantExpenses[0]?.participant;
  const travelerNames = participantExpenses.map((item) => item.participant.employeeName).filter(Boolean).join(", ");
  const reportApprovalLine = reportApprovalLineForDocument(trip.reportApprovalLine);
  return (
    <section className={styles.printBundle} aria-hidden="true">
      {participantExpenses.map((item) => <ParticipantApplication key={item.participant.id} trip={trip} item={item} transportLabel={transportLabel} today={today} />)}
      {expenseGroups.map((items, index) => <ExpenseStatement key={`expense-${index}`} trip={trip} items={items} expense={expense} transportLabel={transportLabel} />)}
      <article className={`${styles.a4Portrait} ${styles.reportPage}`}>
        <h1>출장복명서</h1>
        <div className={styles.approvalBox}><span>결재</span><div>{reportApprovalLine[0]}</div><div>{reportApprovalLine[1]}</div><span /><div /><div /></div>
        <table className={`${styles.formTable} ${styles.reportTable}`}><tbody>
          <tr><th>출장자</th><td>{travelerNames}</td></tr>
          <tr><th>일시</th><td>{dateKorean(trip.startAt)} ({weekday(trip.startAt)}) {timeOnly(trip.startAt)}~{timeOnly(trip.endAt)}</td></tr>
          <tr><th>출장지</th><td>{trip.destination}</td></tr>
          <tr><th>출장목적</th><td className={styles.center}>{trip.purpose}</td></tr>
          <tr><th>출장내용</th><td className={`${styles.reportBody} ${reportDensityClass}`}>{reportLines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</td></tr>
        </tbody></table>
        <div className={styles.reportSign}><p>위와 같이 복명합니다.</p><p>{dateKorean(today)}</p><p>복명자 :　{reporter?.employeeName || ""}　(인)</p></div>
      </article>
    </section>
  );
}

export default function TravelWorkspace({ user, defaultOrigin, defaultReportApprovalLine, signOutPath }) {
  const [trip, setTrip] = useState(() => blankTrip(user, defaultOrigin, defaultReportApprovalLine));
  const [approvedPdfFile, setApprovedPdfFile] = useState(null);
  const [sourceHwpxFile, setSourceHwpxFile] = useState(null);
  const [approvedPdfPending, setApprovedPdfPending] = useState(false);
  const [sourceHwpxPending, setSourceHwpxPending] = useState(false);
  const [sourceMismatch, setSourceMismatch] = useState("");
  const [recentTrips, setRecentTrips] = useState([]);
  const [farePresets, setFarePresets] = useState([]);
  const [fareOptions, setFareOptions] = useState([]);
  const [fareDirection, setFareDirection] = useState("outbound");
  const [fareNotice, setFareNotice] = useState("");
  const [localAiSupported, setLocalAiSupported] = useState(null);
  const [ollama, setOllama] = useState({ status: "checking", models: [], model: "", message: "Ollama 확인 중" });
  const [ollamaAllowedOrigin, setOllamaAllowedOrigin] = useState(ORGANIZATION_CONFIG.publicAppUrl);
  const [aiProgress, setAiProgress] = useState({ progress: 0, text: "" });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(() => defaultOrigin
    ? `기본 출발지는 ${defaultOrigin} 사무소입니다. 승인 PDF 또는 원본 HWPX를 올려주세요.`
    : "승인 PDF 또는 원본 HWPX를 올려주세요. 두 파일을 함께 올리면 HWPX 표를 우선 적용합니다.");
  const [activeSection, setActiveSection] = useState("review");
  const pdfInputRef = useRef(null);
  const hwpxInputRef = useRef(null);
  const parseRequestRef = useRef(0);
  const expense = useMemo(() => calculateTripExpense(trip), [trip]);
  const hasSourceDocument = Boolean(approvedPdfFile || sourceHwpxFile);

  useEffect(() => {
    const hasFareSource = Boolean(trip.fareSource || trip.fareSources?.outbound || trip.fareSources?.return);
    if (!farePresets.length
      || hasFareSource
      || tripTransportFares(trip).total
      || normalizeTripWaypoints(trip).length) return;

    const automaticMatch = findAutomaticFareMatch(trip, farePresets);
    if (automaticMatch.ambiguous && !automaticMatch.preset) {
      setNotice(`출발지·출장지 단어에 맞는 관리자 운임이 ${automaticMatch.candidates.length}개이고 금액이 서로 다릅니다. 방향별 운임을 직접 입력하거나 관리자에게 기준표 확인을 요청해 주세요.`);
      return;
    }
    const automaticPreset = automaticMatch.preset;
    if (!automaticPreset) return;

    setTrip((current) => {
      const currentHasFareSource = Boolean(current.fareSource || current.fareSources?.outbound || current.fareSources?.return);
      if (currentHasFareSource
        || tripTransportFares(current).total
        || normalizeTripWaypoints(current).length) return current;
      const currentMatch = findAutomaticFareMatch(current, farePresets);
      if (!currentMatch.preset) return current;
      return updateReportForBasisChange(current, tripWithFarePreset(current, currentMatch.preset));
    });
    setNotice(`관리자 운임 ${automaticPreset.origin} → ${automaticPreset.destination} 왕복 ${money(fareValue(automaticPreset.outbound_fare ?? automaticPreset.outboundFare) + fareValue(automaticPreset.return_fare ?? automaticPreset.returnFare))}을 자동 적용했습니다.`);
  }, [farePresets, trip.id, trip.origin, trip.destination, trip.transportDestination, trip.transportType, trip.tripScope, trip.waypoints, trip.outboundTransportActual, trip.returnTransportActual, trip.fareSource, trip.fareSources]);

  const update = (key, value) => {
    if (["origin", "transportDestination", "destination", "startAt", "endAt", "transportType", "tripScope"].includes(key)) {
      setFareOptions([]);
      setFareNotice("");
      if (trip[key] !== value && tripTransportFares(trip).total) {
        const routeBasisChanged = ["origin", "transportDestination", "destination", "transportType", "tripScope"].includes(key);
        const dateChanged = ["startAt", "endAt"].includes(key);
        const fareSources = [
          ...Object.values(trip.fareSources ?? {}),
          ...(trip.fareSource ? [trip.fareSource] : []),
        ].filter(Boolean);
        if (routeBasisChanged || (dateChanged && fareSources.some((source) => !isManualFareSource(source)))) {
          setNotice("출장 정보가 변경되어 관리자 운임을 다시 확인하고 있습니다.");
        }
      }
    }
    setTrip((current) => {
      const changed = current[key] !== value;
      const routeBasisChanged = changed && ["origin", "transportDestination", "destination", "transportType", "tripScope"].includes(key);
      const dateChanged = changed && ["startAt", "endAt"].includes(key);
      const fareSources = [
        ...Object.values(current.fareSources ?? {}),
        ...(current.fareSource ? [current.fareSource] : []),
      ].filter(Boolean);
      const datedFareChanged = dateChanged && fareSources.some((source) => !isManualFareSource(source));
      const invalidateFare = routeBasisChanged || datedFareChanged;
      const next = {
        ...current,
        [key]: value,
        ...(key === "destination" ? { transportDestination: value } : {}),
        ...(key === "purpose" ? {
          participants: current.participants.map((participant) => ({ ...participant, purpose: value })),
        } : {}),
        ...(invalidateFare ? {
          outboundTransportActual: 0,
          returnTransportActual: 0,
          transportActual: 0,
          fareSource: null,
          fareSources: {},
        } : {}),
      };
      return ["origin", "transportDestination", "destination", "startAt", "endAt", "purpose", "reportNotes"].includes(key)
        ? updateReportForBasisChange(current, next)
        : next;
    });
  };

  function updateOriginBase(value) {
    update("origin", value);
    setNotice(value
      ? `${value} 사무소를 출발 기준지로 적용했습니다. 관리자 운임을 다시 확인합니다.`
      : "실제 출장 출발 사무소를 선택해 주세요.");
  }

  function openExpenseSection() {
    const informationError = tripRequiredInformationValidationError(trip)
      || tripDateValidationError(trip.startAt, trip.endAt)
      || (!String(trip.origin || "").trim() ? "실제 출장 출발 사무소를 선택해 주세요." : "");
    if (informationError) {
      setNotice(informationError);
      setActiveSection("review");
      return;
    }
    setActiveSection("expense");
  }

  function openReportSection() {
    const informationError = tripRequiredInformationValidationError(trip)
      || tripDateValidationError(trip.startAt, trip.endAt)
      || (!String(trip.origin || "").trim() ? "복명서 작성 전에 실제 출장 출발 사무소를 선택해 주세요." : "");
    if (informationError) {
      setNotice(informationError);
      setActiveSection("review");
      return;
    }
    setActiveSection("report");
  }

  function updateReportContent(value) {
    setTrip((current) => ({
      ...current,
      reportContent: value,
      reportContentSource: "manual",
      reportBasisKey: reportBasisKey(current),
      reportNeedsReview: false,
    }));
  }

  function setGeneratedReport(content, source, generatedTrip) {
    const generatedBasis = reportBasisKey(generatedTrip);
    setTrip((current) => {
      const currentBasis = reportBasisKey(current);
      return {
        ...current,
        reportContent: content,
        reportContentSource: source,
        reportBasisKey: currentBasis,
        reportNeedsReview: generatedBasis !== currentBasis,
      };
    });
  }

  function confirmReportReview() {
    setTrip((current) => ({
      ...current,
      reportContentSource: "manual",
      reportBasisKey: reportBasisKey(current),
      reportNeedsReview: false,
    }));
    setNotice("변경된 출장 정보와 복명 내용을 확인했습니다.");
  }

  function finalDocumentError() {
    // 금액으로 읽지 못한 값이 남아 있으면 제출 서류를 만들지 않는다.
    // 0원으로 채운 신청서가 그대로 결재에 올라가는 일을 막는다.
    const amountIssue = tripAmountIssues(trip)[0];
    return sourceMismatch
      || tripRequiredInformationValidationError(trip)
      || tripDateValidationError(trip.startAt, trip.endAt)
      || amountIssue
      || tripRouteValidationError(trip)
      || reportDocumentError(trip)
      || (trip.reportNeedsReview ? "출장 정보가 바뀌었습니다. 복명 내용을 다시 작성하거나 확인 완료해 주세요." : "");
  }

  function updateParticipant(participantId, key, value) {
    setTrip((current) => {
      const participants = current.participants.map((participant) => participant.id === participantId
        ? {
            ...participant,
            [key]: value,
            ...(key === "mealsProvided" ? { mealsProvided: { ...participant.mealsProvided, ...value } } : {}),
          }
        : participant);
      const primary = participants[0];
      const next = {
        ...current,
        participants,
        department: primary.department,
        position: primary.position,
        employeeName: primary.employeeName,
        lodgingActual: primary.lodgingActual,
        deduction: primary.deduction,
        mealsProvided: primary.mealsProvided,
      };
      return updateReportForBasisChange(current, next);
    });
  }

  function setTransportClaimant(participantId) {
    setTrip((current) => ({
      ...current,
      participants: current.participants.map((participant) => ({
        ...participant,
        transportClaimant: participant.id === participantId,
      })),
    }));
  }

  function addParticipant() {
    const participant = newParticipant();
    setTrip((current) => updateReportForBasisChange(current, { ...current, participants: [...current.participants, participant] }));
    setNotice("동반 출장자를 추가했습니다. 성명·부서·직위를 확인해 주세요.");
  }

  function removeParticipant(participantId) {
    setTrip((current) => {
      if (current.participants.length <= 1) return current;
      const removed = current.participants.find((participant) => participant.id === participantId);
      const participants = current.participants.filter((participant) => participant.id !== participantId);
      if (removed?.transportClaimant && participants.length) participants[0] = { ...participants[0], transportClaimant: true };
      const primary = participants[0];
      const next = {
        ...current,
        participants,
        department: primary.department,
        position: primary.position,
        employeeName: primary.employeeName,
        reporterParticipantId: current.reporterParticipantId === participantId ? primary.id : current.reporterParticipantId,
      };
      return updateReportForBasisChange(current, next);
    });
  }

  function addWaypoint() {
    setTrip((current) => updateReportForBasisChange(current, {
      ...current,
      waypoints: [...(current.waypoints ?? []), { id: crypto.randomUUID(), name: "" }],
      outboundTransportActual: 0,
      returnTransportActual: 0,
      transportActual: 0,
      fareSource: null,
      fareSources: {},
    }));
    setFareOptions([]);
    setFareNotice("");
    setNotice("경유지가 추가되어 왕복 운임을 다시 확인해 주세요.");
  }

  function updateWaypoint(waypointId, name) {
    setTrip((current) => updateReportForBasisChange(current, {
      ...current,
      waypoints: (current.waypoints ?? []).map((waypoint) => waypoint.id === waypointId ? { ...waypoint, name } : waypoint),
      outboundTransportActual: 0,
      returnTransportActual: 0,
      transportActual: 0,
      fareSource: null,
      fareSources: {},
    }));
    setFareOptions([]);
    setFareNotice("");
    setNotice("경유지가 변경되어 왕복 운임을 다시 확인해 주세요.");
  }

  function removeWaypoint(waypointId) {
    setTrip((current) => updateReportForBasisChange(current, {
      ...current,
      waypoints: (current.waypoints ?? []).filter((waypoint) => waypoint.id !== waypointId),
      outboundTransportActual: 0,
      returnTransportActual: 0,
      transportActual: 0,
      fareSource: null,
      fareSources: {},
    }));
    setFareOptions([]);
    setFareNotice("");
    setNotice("경유지가 삭제되어 왕복 운임을 다시 확인하고 있습니다.");
  }

  function updateDirectionalFare(direction, value) {
    const key = direction === "return" ? "returnTransportActual" : "outboundTransportActual";
    setTrip((current) => {
      const nextValue = fareValue(value);
      const outbound = key === "outboundTransportActual" ? nextValue : fareValue(current.outboundTransportActual);
      const returning = key === "returnTransportActual" ? nextValue : fareValue(current.returnTransportActual);
      const points = tripRoutePoints(current, direction);
      const source = {
        provider: "직접 입력",
        mode: current.transportType,
        departure: points[0] || "",
        arrival: points.at(-1) || "",
        grade: "수동 운임",
        oneWayFare: nextValue,
        retrievedAt: new Date().toISOString(),
      };
      return {
        ...current,
        [key]: nextValue,
        transportActual: outbound + returning,
        fareSource: source,
        fareSources: { ...(current.fareSources ?? {}), [direction]: source },
      };
    });
  }

  async function detectOllama({ notify = false } = {}) {
    setOllama((current) => ({ ...current, status: "checking", message: "Ollama 확인 중" }));
    try {
      const models = await listOllamaModels();
      const savedModel = window.localStorage.getItem("travel:ollama-model") || "";
      const modelNames = models.map((item) => item.name);
      const model = modelNames.includes(savedModel) ? savedModel : choosePreferredOllamaModel(modelNames);
      const next = { status: "connected", models, model, message: `Ollama 연결됨 · ${model}` };
      setOllama(next);
      if (model) window.localStorage.setItem("travel:ollama-model", model);
      if (notify) setNotice(`내 PC의 Ollama에 연결했습니다. ${model} 모델을 사용합니다.`);
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ollama에 연결할 수 없습니다.";
      const next = { status: "unavailable", models: [], model: "", message };
      setOllama(next);
      if (notify) setNotice(`${message} 브라우저 로컬 AI 또는 규칙형 초안을 사용합니다.`);
      return next;
    }
  }

  function changeOllamaModel(model) {
    window.localStorage.setItem("travel:ollama-model", model);
    setOllama((current) => ({ ...current, model, message: `Ollama 연결됨 · ${model}` }));
  }

  async function loadFarePresets() {
    try {
      const response = await fetch("/api/travel/fare-presets");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "관리자 운임 기준표를 불러오지 못했습니다.");
      setFarePresets(data.presets ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "관리자 운임 기준표를 불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    setLocalAiSupported(supportsLocalReportAI());
    setOllamaAllowedOrigin(window.location.origin);
    detectOllama();
    const lastChunkReload = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (Date.now() - lastChunkReload < CHUNK_RELOAD_COOLDOWN_MS) {
      setNotice("새 버전으로 자동 갱신했습니다. 출장신청 PDF 또는 HWPX를 다시 선택해 주세요.");
    }

    const recoverFromChunkError = () => {
      const lastReload = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
      if (Date.now() - lastReload < CHUNK_RELOAD_COOLDOWN_MS) {
        setNotice("새 버전 파일을 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.");
        return;
      }
      window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
      window.location.reload();
    };
    const isChunkLoadError = (value) => /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(String(value || ""));
    const handleWindowError = (event) => {
      if (!isChunkLoadError(event?.message || event?.error?.message)) return;
      event.preventDefault();
      recoverFromChunkError();
    };
    const handleUnhandledRejection = (event) => {
      if (!isChunkLoadError(event?.reason?.message || event?.reason)) return;
      event.preventDefault();
      recoverFromChunkError();
    };
    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    fetch("/api/travel/trips")
      .then((response) => response.ok ? response.json() : { trips: [] })
      .then((data) => setRecentTrips(data.trips ?? []))
      .catch(() => setRecentTrips([]));
    loadFarePresets();
    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  async function draftReport() {
    if (!String(trip.reportNotes || "").trim()) {
      setNotice("로컬 AI가 사실만 사용하도록 실제 수행 결과 메모를 한 줄 이상 입력해 주세요.");
      return;
    }

    setBusy("report-ai");
    setAiProgress({ progress: 0, text: "로컬 모델 확인 중" });
    try {
      const progress = (value) => setAiProgress({
        progress: Math.max(0, Math.min(1, Number(value?.progress) || 0)),
        text: value?.text || "로컬 모델 준비 중",
      });
      const availableOllama = ollama.status === "connected" ? ollama : await detectOllama();
      let result;
      if (availableOllama.status === "connected" && availableOllama.model) {
        try {
          result = await draftTravelReportWithOllama(trip, { model: availableOllama.model, onProgress: progress });
        } catch (ollamaError) {
          if (!localAiSupported) throw ollamaError;
          setAiProgress({ progress: 0, text: "브라우저 Qwen으로 전환 중" });
          result = await draftTravelReportLocally(trip, { onProgress: progress });
        }
      } else if (localAiSupported) {
        result = await draftTravelReportLocally(trip, { onProgress: progress });
      } else {
        throw new Error(availableOllama.message || "사용할 수 있는 로컬 AI가 없습니다.");
      }
      setGeneratedReport(result.content, "ai", trip);
      setAiProgress({ progress: 1, text: `${result.model} 초안 작성 완료` });
      setNotice(result.provider === "ollama"
        ? `내 PC의 Ollama ${result.model}로 복명서 초안을 만들었습니다. 제출 전에 사실관계를 확인해 주세요.`
        : "출장 정보와 결과 메모를 브라우저 안에서 처리해 복명서 초안을 만들었습니다. 제출 전에 사실관계를 확인해 주세요.");
    } catch (error) {
      setGeneratedReport(buildRuleBasedTravelReport(trip), "rule", trip);
      setAiProgress({ progress: 1, text: "규칙형 안전 초안으로 전환됨" });
      setNotice(`${error instanceof Error ? error.message : "로컬 AI를 실행하지 못했습니다."} 입력한 메모로 규칙형 초안을 만들었습니다.`);
    } finally {
      setBusy("");
    }
  }

  async function applyParsedTravel(parsed, sourceLabel, extraNotice = "", requestId = parseRequestRef.current) {
    setFareOptions([]);
    setFareNotice("");
    let availablePresets = farePresets;
    if (!availablePresets.length) {
      try {
        const presetResponse = await fetch("/api/travel/fare-presets");
        const presetData = await presetResponse.json().catch(() => ({}));
        if (presetResponse.ok) {
          availablePresets = presetData.presets ?? [];
          setFarePresets(availablePresets);
        }
      } catch {}
    }
    if (parseRequestRef.current !== requestId) return;
    const parsedParticipants = (parsed.participants?.length ? parsed.participants : [{
      department: parsed.department,
      position: parsed.position,
      employeeName: parsed.employeeName,
      transportClaimant: true,
    }]).map((participant, index) => newParticipant({
      ...participant,
      id: crypto.randomUUID(),
      transportClaimant: index === 0,
    }));
    let nextTrip = {
      ...trip,
      ...parsed,
      id: trip.id,
      origin: String(parsed.origin || "").trim() || trip.origin || defaultOrigin || "",
      participants: parsedParticipants,
      reporterParticipantId: parsedParticipants[0].id,
      department: parsedParticipants[0].department,
      position: parsedParticipants[0].position,
      employeeName: parsedParticipants[0].employeeName,
      waypoints: [],
      transportDestination: parsed.destination || "",
      outboundTransportActual: 0,
      returnTransportActual: 0,
      transportActual: 0,
      fareSource: null,
      fareSources: {},
      lodgingActual: 0,
      deduction: 0,
      mealsProvided: parsedParticipants[0].mealsProvided,
      reportNotes: "",
    };
    const automaticMatch = findAutomaticFareMatch(nextTrip, availablePresets);
    const automaticPreset = automaticMatch.preset;
    if (automaticPreset) {
      const appliedTrip = tripWithFarePreset(nextTrip, automaticPreset);
      nextTrip = {
        ...appliedTrip,
        outboundTransportActual: fareValue(appliedTrip.outboundTransportActual),
        returnTransportActual: fareValue(appliedTrip.returnTransportActual),
        transportActual: fareValue(appliedTrip.outboundTransportActual) + fareValue(appliedTrip.returnTransportActual),
      };
    }
    setTrip({
      ...nextTrip,
      reportContent: buildRuleBasedTravelReport(nextTrip),
      reportContentSource: "rule",
      reportBasisKey: reportBasisKey(nextTrip),
      reportNeedsReview: false,
    });
    setAiProgress({ progress: 0, text: "" });
    const participantNotice = parsed.participants?.length > 1 ? ` 출장자 ${parsed.participants.length}명을 분리했습니다.` : "";
    const fareNoticeText = !nextTrip.origin
      ? " 실제 출장 출발 사무소를 선택하면 관리자 운임을 자동 적용합니다."
        : automaticPreset
          ? ` 관리자 운임 ${automaticPreset.origin} → ${automaticPreset.destination} 왕복 ${money(tripTransportFares(nextTrip).total)}을 자동 적용했습니다.`
          : automaticMatch.ambiguous
            ? ` 같은 지역 단어에 금액이 다른 관리자 운임 ${automaticMatch.candidates.length}개가 있어 자동 적용하지 않았습니다. 방향별 운임을 직접 입력하거나 관리자에게 기준표 확인을 요청해 주세요.`
        : parsed.transportType === "corporate"
          ? " 법인차는 대중교통 운임 대신 통행료·주차비를 직접 확인해 주세요."
          : " 일치하는 관리자 운임이 없어 여비계산에서 금액을 확인해 주세요.";
    const missingNotice = parsed.missing.length
      ? `${parsed.missing.join(", ")} 항목은 직접 확인해 주세요.`
      : `${sourceLabel}에서 승인서 주요 항목을 모두 읽었습니다.`;
    setNotice(`${missingNotice}${participantNotice}${fareNoticeText}${extraNotice}`);
    setActiveSection("review");
  }

  async function readTravelFiles(fileList) {
    if (busy) {
      setNotice("현재 작업이 끝난 뒤 원본 파일을 선택해 주세요.");
      return;
    }
    const selected = Array.from(fileList || []);
    if (!selected.length) return;
    const pdfFiles = selected.filter(isPdfFile);
    const hwpxFiles = selected.filter(isHwpxFile);
    if (pdfFiles.length > 1 || hwpxFiles.length > 1) {
      setNotice("PDF와 HWPX는 한 번에 한 파일씩만 선택해 주세요.");
      return;
    }
    if (pdfFiles.length + hwpxFiles.length !== selected.length) {
      setNotice("PDF 또는 HWPX 파일만 올릴 수 있습니다. 구형 HWP는 한글에서 HWPX로 저장해 주세요.");
      return;
    }
    const selectedPdf = pdfFiles[0] || null;
    const selectedHwpx = hwpxFiles[0] || null;
    if (!selectedPdf && !selectedHwpx) {
      setNotice("PDF 또는 HWPX 파일을 선택해 주세요. 구형 HWP는 한글에서 HWPX로 저장한 뒤 올릴 수 있습니다.");
      return;
    }
    const oversized = [selectedPdf, selectedHwpx].find((file) => file && file.size > MAX_SOURCE_FILE_SIZE);
    if (oversized) {
      setNotice(`${oversized.name} 파일이 4MB를 넘습니다. 원본 크기를 줄인 뒤 다시 올려주세요.`);
      return;
    }
    const candidatePdf = selectedPdf || approvedPdfFile;
    const candidateHwpx = selectedHwpx || sourceHwpxFile;
    if ((candidatePdf?.size || 0) + (candidateHwpx?.size || 0) > MAX_SOURCE_FILE_SIZE) {
      setNotice("PDF와 HWPX의 합계가 4MB를 넘습니다. 원본 크기를 줄인 뒤 다시 올려주세요.");
      return;
    }

    const requestId = parseRequestRef.current + 1;
    parseRequestRef.current = requestId;
    setBusy("parse");
    setNotice("승인 문서의 표와 내용을 읽고 있습니다.");
    try {
      if (selectedPdf && !selectedHwpx && sourceHwpxFile) {
        const pdfParsed = await extractApprovedTravelPdf(selectedPdf);
        const hwpxParsed = await extractApprovedTravelHwpx(sourceHwpxFile);
        const mergedParsed = mergeParsedTravelDocuments(pdfParsed, hwpxParsed);
        if (parseRequestRef.current !== requestId) return;
        setApprovedPdfFile(selectedPdf);
        setApprovedPdfPending(true);
        setTrip((current) => {
          const next = { ...current };
          ["documentNumber", "documentTitle", "department", "position", "employeeName", "purpose", "destination", "startAt", "endAt"].forEach((key) => {
            if (!String(next[key] || "").trim() && mergedParsed?.[key]) next[key] = mergedParsed[key];
          });
          next.participants = (current.participants || []).map((participant, index) => index === 0 ? {
            ...participant,
            department: participant.department || mergedParsed?.participants?.[0]?.department || mergedParsed?.department || "",
            position: participant.position || mergedParsed?.participants?.[0]?.position || mergedParsed?.position || "",
            employeeName: participant.employeeName || mergedParsed?.participants?.[0]?.employeeName || mergedParsed?.employeeName || "",
            purpose: participant.purpose || mergedParsed?.participants?.[0]?.purpose || mergedParsed?.purpose || "",
          } : participant);
          if (!next.transportDestination && !current.destination && mergedParsed?.destination) next.transportDestination = mergedParsed.destination;
          if (!hwpxParsed.transportType && mergedParsed?.transportType && current.transportType !== mergedParsed.transportType) {
            next.transportType = mergedParsed.transportType;
            next.outboundTransportActual = 0;
            next.returnTransportActual = 0;
            next.transportActual = 0;
            next.fareSource = null;
            next.fareSources = {};
          }
          next.missing = parsedTravelMissing(next);
          return updateReportForBasisChange(current, next);
        });
        const mismatchMessage = sourcePairValidationError(pdfParsed, hwpxParsed);
        const mismatch = Boolean(mismatchMessage);
        setSourceMismatch(mismatchMessage);
        setNotice(mismatch
          ? `승인 PDF를 첨부했지만 원본 짝을 확인해야 합니다. ${mismatchMessage}`
          : "승인 PDF를 증빙으로 첨부했습니다. HWPX 값을 우선 유지하고 비어 있던 항목만 PDF로 보완했습니다.");
        return;
      }

      let pdfParsed = null;
      let hwpxParsed = null;
      let pdfError = "";
      let hwpxError = "";
      const pdfToRead = selectedPdf || (selectedHwpx ? approvedPdfFile : null);
      if (pdfToRead) {
        try {
          pdfParsed = await extractApprovedTravelPdf(pdfToRead);
        } catch (error) {
          pdfError = error instanceof Error ? error.message : "PDF를 읽지 못했습니다.";
        }
      }
      if (selectedHwpx) {
        try {
          hwpxParsed = await extractApprovedTravelHwpx(selectedHwpx);
        } catch (error) {
          hwpxError = error instanceof Error ? error.message : "HWPX를 읽지 못했습니다.";
        }
      }
      if (parseRequestRef.current !== requestId) return;
      if (selectedPdf && selectedHwpx && (!pdfParsed || !hwpxParsed)) {
        throw new Error(`두 파일을 함께 선택했지만 모두 읽지 못했습니다. ${pdfError || hwpxError}`.trim());
      }
      if (selectedHwpx && approvedPdfFile && !selectedPdf && !pdfParsed) {
        throw new Error(`기존 PDF와 새 HWPX를 함께 확인하지 못해 교체를 취소했습니다. ${pdfError}`.trim());
      }
      if (selectedPdf && pdfParsed) {
        setApprovedPdfFile(selectedPdf);
        setApprovedPdfPending(true);
      }
      if (selectedHwpx && hwpxParsed) {
        setSourceHwpxFile(selectedHwpx);
        setSourceHwpxPending(true);
      }

      if (!hwpxParsed && selectedHwpx && !selectedPdf) {
        throw new Error(hwpxError || "HWPX를 읽지 못했습니다.");
      }
      const parsed = mergeParsedTravelDocuments(pdfParsed, hwpxParsed);
      if (!parsed) throw new Error(hwpxError || pdfError || "승인 문서에서 출장 정보를 읽지 못했습니다.");
      const mismatchMessage = sourcePairValidationError(pdfParsed, hwpxParsed);
      const mismatch = Boolean(mismatchMessage);
      setSourceMismatch(mismatchMessage);
      const extraNotice = mismatch
        ? ` ${mismatchMessage}`
        : pdfError && hwpxParsed
          ? ` PDF는 읽지 못해 첨부하지 않았습니다: ${pdfError}`
        : hwpxError
          ? ` HWPX는 읽지 못해 PDF 결과를 사용했습니다: ${hwpxError}`
          : "";
      await applyParsedTravel(parsed, hwpxParsed ? "원본 HWPX 표" : "승인 PDF", extraNotice, requestId);
    } catch (error) {
      if (parseRequestRef.current === requestId) setNotice(error instanceof Error ? error.message : "승인 문서를 읽지 못했습니다.");
    } finally {
      if (parseRequestRef.current === requestId) setBusy("");
    }
  }

  async function saveTrip() {
    const validationError = finalDocumentError();
    if (validationError) {
      setNotice(validationError);
      setActiveSection(trip.reportNeedsReview ? "report" : "review");
      return;
    }
    setBusy("save");
    try {
      const formData = new FormData();
      const tripForSave = { ...trip };
      delete tripForSave.parsedText;
      formData.set("trip", JSON.stringify({ ...tripForSave, expense }));
      if (approvedPdfPending && approvedPdfFile) formData.set("approvedPdf", approvedPdfFile);
      if (sourceHwpxPending && sourceHwpxFile) formData.set("sourceHwpx", sourceHwpxFile);
      const response = await fetch("/api/travel/trips", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "저장하지 못했습니다.");
      setNotice(data.duplicateWarnings?.length
        ? `저장했습니다. 중복 확인 필요: ${data.duplicateWarnings.join(" / ")}`
        : data.sourceCleanupWarning
          ? `출장 서류와 원본 문서를 저장했습니다. ${data.sourceCleanupWarning}`
          : "출장 서류와 첨부한 원본 문서를 안전하게 저장했습니다.");
      setApprovedPdfPending(false);
      setSourceHwpxPending(false);
      setRecentTrips((current) => [data.trip, ...current.filter((item) => item.id !== data.trip.id)].slice(0, 12));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "저장하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function deleteTrip(item) {
    const destination = item.destination || "출장지 미입력";
    const tripDate = String(item.start_at || "").slice(0, 10) || "날짜 미입력";
    if (!window.confirm(`${tripDate} ${destination} 출장을 삭제할까요?\n저장한 서류와 원본 PDF·HWPX가 함께 삭제되며 복구할 수 없습니다.`)) return;

    const isCurrentTrip = trip.id === item.id;
    setBusy(`delete-${item.id}`);
    try {
      const response = await fetch(`/api/travel/trips?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (response.status === 404) {
        setRecentTrips((current) => current.filter((savedTrip) => savedTrip.id !== item.id));
        if (isCurrentTrip) {
          setTrip((current) => ({ ...current, id: crypto.randomUUID() }));
          setApprovedPdfPending(Boolean(approvedPdfFile));
          setSourceHwpxPending(Boolean(sourceHwpxFile));
        }
        setNotice("이미 삭제된 출장이라 저장 목록에서 정리했습니다.");
        return;
      }
      if (!response.ok) throw new Error(data.error || "출장 서류를 삭제하지 못했습니다.");
      setRecentTrips((current) => current.filter((savedTrip) => savedTrip.id !== data.deletedId));
      if (isCurrentTrip) {
        setTrip((current) => ({ ...current, id: crypto.randomUUID() }));
        setApprovedPdfPending(Boolean(approvedPdfFile));
        setSourceHwpxPending(Boolean(sourceHwpxFile));
      }
      setNotice(isCurrentTrip
        ? "저장본과 원본 문서를 삭제했습니다. 화면의 작성 내용은 저장되지 않은 초안으로 남겨두었습니다."
        : "저장한 출장 서류와 원본 문서를 삭제했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "출장 서류를 삭제하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function downloadExcel() {
    const validationError = finalDocumentError();
    if (validationError) {
      setNotice(validationError);
      setActiveSection(trip.reportNeedsReview ? "report" : "review");
      return;
    }
    setBusy("excel");
    try {
      const blob = await buildTravelWorkbook(trip, expense);
      downloadBlob(blob, travelWorkbookFilename(trip));
      const statementCount = Math.ceil(trip.participants.length / 5);
      setNotice(`출장자별 신청서 ${trip.participants.length}부, 지출명세서 ${statementCount}부, 복명서 1부를 A4 양식으로 만들었습니다.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Excel을 만들지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  function printTrip() {
    const validationError = finalDocumentError();
    if (validationError) {
      setNotice(validationError);
      setActiveSection(trip.reportNeedsReview ? "report" : "review");
      return;
    }
    window.print();
  }

  async function lookupFares(direction = "outbound") {
    const date = String((direction === "return" ? trip.endAt : trip.startAt) || "").slice(0, 10);
    const points = tripRoutePoints(trip, direction);
    const directionLabel = direction === "return" ? "오는 길" : "가는 길";
    if (points.length < 2 || !date) {
      setFareNotice("출발지, 출장지, 경유지, 출장일을 먼저 확인해 주세요.");
      return;
    }
    setBusy(`fare-${direction}`);
    setFareDirection(direction);
    setFareNotice(`${directionLabel} 열차·고속버스·시외버스 운임을 구간별로 조회하고 있습니다.`);
    try {
      const segmentResults = await Promise.all(points.slice(0, -1).map(async (origin, index) => {
        const destination = points[index + 1];
        const query = new URLSearchParams({ origin, destination, date });
        const response = await fetch(`/api/travel/fares?${query}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `${origin} → ${destination} 운임을 조회하지 못했습니다.`);
        return { origin, destination, ...data };
      }));

      if (segmentResults.length === 1) {
        setFareOptions((segmentResults[0].options ?? []).map((option) => ({ ...option, direction, routeSegments: [option] })));
      } else {
        const selectedSegments = segmentResults.map((segment) => ({
          ...segment,
          option: (segment.options ?? []).find((option) => option.recommended) ?? segment.options?.[0],
        }));
        const missing = selectedSegments.find((segment) => !segment.option);
        if (missing) throw new Error(`${missing.origin} → ${missing.destination} 구간의 운임을 찾지 못했습니다.`);
        const routeSegments = selectedSegments.map((segment) => segment.option);
        const providers = [...new Set(routeSegments.map((option) => option.provider))];
        setFareOptions([{
          id: `${direction}-${routeSegments.map((option) => option.id).join("-")}`,
          direction,
          mode: [...new Set(routeSegments.map((option) => option.mode))].join("+"),
          provider: providers.join(" + "),
          departure: points[0],
          arrival: points.at(-1),
          departureTime: routeSegments[0]?.departureTime || "",
          grade: "경유 구간 합산",
          oneWayFare: routeSegments.reduce((sum, option) => sum + option.oneWayFare, 0),
          routeSegments,
          recommended: true,
        }]);
      }
      const segmentText = points.length > 2 ? ` · ${points.length - 1}개 구간 합산` : "";
      setFareNotice(`${directionLabel} ${points.join(" → ")} 조회 결과${segmentText}입니다.`);
    } catch (error) {
      setFareOptions([]);
      setFareNotice(error instanceof Error ? error.message : "교통 운임을 조회하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  function applyFare(option) {
    const direction = option.direction || fareDirection;
    const directionKey = direction === "return" ? "returnTransportActual" : "outboundTransportActual";
    const directionLabel = direction === "return" ? "오는 길" : "가는 길";
    setTrip((current) => ({
      ...current,
      [directionKey]: option.oneWayFare,
      transportActual: option.oneWayFare + (direction === "return" ? Number(current.outboundTransportActual) || 0 : Number(current.returnTransportActual) || 0),
      fareSource: {
        provider: option.provider,
        mode: option.mode,
        departure: option.departure,
        arrival: option.arrival,
        grade: option.grade,
        oneWayFare: option.oneWayFare,
        routeSegments: option.routeSegments,
        departureTime: option.departureTime,
        retrievedAt: new Date().toISOString(),
      },
      fareSources: {
        ...(current.fareSources ?? {}),
        [direction]: {
          provider: option.provider,
          mode: option.mode,
          departure: option.departure,
          arrival: option.arrival,
          grade: option.grade,
          oneWayFare: option.oneWayFare,
          routeSegments: option.routeSegments,
          departureTime: option.departureTime,
          retrievedAt: new Date().toISOString(),
        },
      },
    }));
    setNotice(`${directionLabel} ${option.provider} ${option.grade} ${money(option.oneWayFare)}을 운임 기준으로 적용했습니다.`);
  }

  function resetTrip() {
    parseRequestRef.current += 1;
    setBusy("");
    setTrip(blankTrip(user, defaultOrigin, defaultReportApprovalLine));
    setApprovedPdfFile(null);
    setSourceHwpxFile(null);
    setApprovedPdfPending(false);
    setSourceHwpxPending(false);
    setSourceMismatch("");
    if (pdfInputRef.current) pdfInputRef.current.value = "";
    if (hwpxInputRef.current) hwpxInputRef.current.value = "";
    setFareOptions([]);
    setFareDirection("outbound");
    setFareNotice("");
    setAiProgress({ progress: 0, text: "" });
    setNotice(defaultOrigin
      ? `새 출장의 기본 출발지를 ${defaultOrigin} 사무소로 적용했습니다.`
      : "새 출장신청 PDF 또는 HWPX를 올려주세요.");
  }

  return (
    <main className={styles.travelApp}>
      <header className={styles.header}>
        <a href="/" className={styles.brand}><span>出</span><div><strong>{ORGANIZATION_CONFIG.appName}</strong><small>{ORGANIZATION_CONFIG.brandEnglish}</small></div></a>
        <nav aria-label="주요 메뉴"><a className={styles.navActive} href="#workspace">새 서류</a><a href="#recent">내 출장</a><a href="#policy">규정 기준</a></nav>
        <div className={styles.account}><span>{(user.displayName || user.email).slice(0, 1).toUpperCase()}</span><div><strong>{user.displayName}</strong><small>{user.email}</small></div><a href="/account">환경 설정</a><a href={signOutPath}>로그아웃</a></div>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>APPROVED PDF + HWPX → A4 DOCUMENTS</p>
          <h1>승인서는 한 번만.<br />출장 서류는 한 번에.</h1>
          <p>승인 PDF와 원본 HWPX를 함께 받아 표 구조를 우선 읽고, 여비 규정을 적용해 여비지급신청서·지출명세서·출장복명서를 이어서 완성합니다.</p>
          <div className={styles.rulePills}><span>동반 출장자 자동 분리</span><span>교통비 대표 1명</span><span>법인차 일비 {Math.round(TRAVEL_POLICY.corporateDailyRate * 100)}%</span><span>고용부 도내 식비 {money(TRAVEL_POLICY.laborMealDailyCap)}</span></div>
        </div>
        <div className={styles.uploadPanel} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); readTravelFiles(event.dataTransfer.files); }}>
          <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { readTravelFiles(event.target.files); event.target.value = ""; }} />
          <input ref={hwpxInputRef} type="file" accept=".hwpx,application/vnd.hancom.hwpx,application/zip" hidden onChange={(event) => { readTravelFiles(event.target.files); event.target.value = ""; }} />
          <div className={styles.uploadIntro}>
            <strong>승인 문서 원본</strong>
            <p>두 파일을 한 번에 끌어놓아도 됩니다. HWPX 표 값을 우선 적용하고 PDF는 승인 증빙으로 함께 저장합니다.</p>
          </div>
          <div className={styles.uploadFileGrid}>
            <article className={approvedPdfFile ? styles.uploadFileReady : ""}>
              <div className={styles.uploadMark}>PDF</div>
              <span>승인 PDF</span>
              <strong title={approvedPdfFile?.name}>{approvedPdfFile?.name || "전자결재 승인본"}</strong>
              <small>승인 증빙·원본 보관</small>
              <button type="button" onClick={() => pdfInputRef.current?.click()} disabled={Boolean(busy)}>{approvedPdfFile ? "PDF 교체" : "PDF 선택"}</button>
            </article>
            <article className={sourceHwpxFile ? styles.uploadFileReady : ""}>
              <div className={`${styles.uploadMark} ${styles.uploadMarkHwpx}`}>HWPX</div>
              <span>원본 HWPX</span>
              <strong title={sourceHwpxFile?.name}>{sourceHwpxFile?.name || "한글 원본 파일"}</strong>
              <small>표 구조 우선 추출·원본 보관</small>
              <button type="button" onClick={() => hwpxInputRef.current?.click()} disabled={Boolean(busy)}>{sourceHwpxFile ? "HWPX 교체" : "HWPX 선택"}</button>
            </article>
          </div>
          <p className={styles.uploadHint}>{busy === "parse" ? "문서를 읽는 중입니다…" : "PDF는 브라우저에서, HWPX는 정확도를 높이기 위해 로그인한 앱 서버의 Kordoc에서도 일시 분석합니다. 저장 전에는 원본을 보관하지 않으며 두 파일 합계는 최대 4MB입니다."}</p>
        </div>
      </section>

      <section className={styles.flowBar} aria-label="처리 단계">
        <span className={hasSourceDocument ? styles.flowDone : styles.flowCurrent}><b>01</b> PDF·HWPX</span><i />
        <span className={hasSourceDocument ? styles.flowCurrent : ""}><b>02</b> 정보·금액 확인</span><i />
        <span><b>03</b> 복명·A4 출력</span>
      </section>

      <section id="workspace" className={styles.workspace}>
        <aside className={styles.sidebar}>
          <button className={activeSection === "review" ? styles.sideActive : ""} onClick={() => setActiveSection("review")}><b>1</b><span>출장 정보 확인<small>승인서 자동 추출</small></span></button>
          <button className={activeSection === "expense" ? styles.sideActive : ""} onClick={openExpenseSection}><b>2</b><span>여비 계산<small>규정 자동 적용</small></span></button>
          <button className={activeSection === "report" ? styles.sideActive : ""} onClick={openReportSection}><b>3</b><span>복명서 작성<small>출장 결과 보완</small></span></button>
          <div className={styles.sideNotice}><span>i</span><p>{notice}</p></div>
          <button className={styles.resetButton} type="button" onClick={resetTrip} disabled={Boolean(busy)}>새 출장 시작</button>
        </aside>

        <div className={styles.editor}>
          {activeSection === "review" ? (
            <section className={styles.panel}>
              <div className={styles.panelHeading}><div><p>STEP 01</p><h2>승인서 정보 확인</h2><span>자동 추출된 값은 모두 수정할 수 있습니다.</span></div><em>{!trip.origin ? "출발지 선택 필요" : trip.missing.length ? `${trip.missing.length}개 확인 필요` : hasSourceDocument ? "추출 완료" : "문서 대기"}</em></div>
              <div className={styles.fieldGrid}>
                <Field label="문서번호"><input value={trip.documentNumber} onChange={(event) => update("documentNumber", event.target.value)} placeholder="예: 기업성장실-138" /></Field>
                <Field label="문서제목"><input value={trip.documentTitle} onChange={(event) => update("documentTitle", event.target.value)} placeholder="출장신청_날짜_성명" /></Field>
                <Field label="출장 구분"><select value={trip.tripScope} onChange={(event) => update("tripScope", event.target.value)}><option value="domestic">국내 출장</option><option value="local">근무지내 출장</option></select></Field>
                <Field label="출장목적" wide><input value={trip.purpose} onChange={(event) => update("purpose", event.target.value)} placeholder="구체적인 출장 목적" /></Field>
                <Field label="출장지(방문기관)" wide hint="교통 도착지도 같은 값으로 작성되며 운임 기준표의 터미널명은 제출 서류에 표시하지 않습니다."><input value={trip.destination} onChange={(event) => update("destination", event.target.value)} placeholder="예: 전북 남원 (남원시 웹단)" /></Field>
                <div className={`${styles.fieldWide} ${styles.waypointField}`}>
                  <div className={styles.waypointHeader}><div><span>경유지</span><small>가는 길 순서대로 추가하면 오는 길에는 역순으로 반영됩니다.</small></div><button type="button" onClick={addWaypoint}>+ 경유지 추가</button></div>
                  {trip.waypoints?.length ? <div className={styles.waypointList}>{trip.waypoints.map((waypoint, index) => <div key={waypoint.id}><b>{index + 1}</b><input value={waypoint.name} onChange={(event) => updateWaypoint(waypoint.id, event.target.value)} placeholder="예: 익산터미널" /><button type="button" onClick={() => removeWaypoint(waypoint.id)} aria-label={`경유지 ${index + 1} 삭제`}>삭제</button></div>)}</div> : <p className={styles.waypointEmpty}>경유지가 없으면 추가하지 않아도 됩니다.</p>}
                </div>
                <Field label="출발 일시"><input type="datetime-local" value={trip.startAt} onChange={(event) => update("startAt", event.target.value)} /></Field>
                <Field label="도착 일시"><input type="datetime-local" value={trip.endAt} onChange={(event) => update("endAt", event.target.value)} /></Field>
                <Field label="출발 기준지(사무소)" hint="실제 출발 사무소를 선택하면 관리자 운임과 제출 서류에 동일하게 반영됩니다.">
                  <select value={trip.origin} onChange={(event) => updateOriginBase(event.target.value)}>
                    <option value="">출발 기준지 선택</option>
                    {ORGANIZATION_CONFIG.originBases.map((origin) => <option key={origin} value={origin}>{origin} 사무소</option>)}
                    {trip.origin && !ORGANIZATION_CONFIG.originBases.includes(trip.origin) ? <option value={trip.origin}>{trip.origin} (기존 저장값)</option> : null}
                  </select>
                </Field>
                <Field label="교통수단"><select value={trip.transportType} onChange={(event) => update("transportType", event.target.value)}>{TRANSPORT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
              </div>
              <section className={styles.participantSection} aria-labelledby="participant-heading">
                <div className={styles.participantHeader}><div><strong id="participant-heading">출장자 {trip.participants.length}명</strong><span>동반 출장자는 자동 분리되며 직접 추가·수정할 수 있습니다.</span></div><button type="button" onClick={addParticipant}>+ 출장자 추가</button></div>
                <div className={styles.participantList}>
                  {trip.participants.map((participant, index) => (
                    <article className={styles.participantCard} key={participant.id}>
                      <div className={styles.participantCardTop}><b>{index + 1}</b><strong>{participant.employeeName || `출장자 ${index + 1}`}</strong><label><input type="radio" name="transport-claimant" checked={participant.transportClaimant} onChange={() => setTransportClaimant(participant.id)} /><span>교통비 대표 수령</span></label>{trip.participants.length > 1 ? <button type="button" onClick={() => removeParticipant(participant.id)} aria-label={`${participant.employeeName || `출장자 ${index + 1}`} 삭제`}>삭제</button> : null}</div>
                      <div className={styles.participantInputs}>
                        <label><span>부서</span><input value={participant.department} onChange={(event) => updateParticipant(participant.id, "department", event.target.value)} /></label>
                        <label><span>직급/직위</span><input value={participant.position} onChange={(event) => updateParticipant(participant.id, "position", event.target.value)} /></label>
                        <label><span>성명</span><input value={participant.employeeName} onChange={(event) => updateParticipant(participant.id, "employeeName", event.target.value)} /></label>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
              <div className={styles.panelFooter}><button type="button" className={styles.primaryButton} onClick={openExpenseSection}>여비 계산 확인 →</button></div>
            </section>
          ) : null}

          {activeSection === "expense" ? (
            <section className={styles.panel}>
              <div className={styles.panelHeading}><div><p>STEP 02</p><h2>여비 자동 계산</h2><span>증빙 금액과 제공 식사만 입력하면 규정이 자동 적용됩니다.</span></div><em>{expense.ruleSummary}</em></div>
              <div className={styles.policyStrip}><div><span>교통 규칙</span><strong>{expense.ruleSummary}</strong></div><div><span>일비 기준</span><strong>{trip.tripScope === "local" ? "시간·차량별 정액" : `${money(TRAVEL_POLICY.dailyAllowance)} / 일`}</strong></div><div><span>식비 기준</span><strong>{trip.tripScope === "local" ? "관내 출장 미지급" : trip.projectType === "labor" && trip.laborMealRegion !== "outProvince" ? `도내 최대 ${money(TRAVEL_POLICY.laborMealDailyCap)}` : `최대 ${money(TRAVEL_POLICY.generalMealDailyCap)}`}</strong></div></div>
              <div className={styles.fieldGrid}>
                <Field label="사업 유형"><select value={trip.projectType} onChange={(event) => update("projectType", event.target.value)}>{PROJECT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
                {trip.projectType === "labor" ? <Field label="고용부 출장 지역"><select value={trip.laborMealRegion} onChange={(event) => update("laborMealRegion", event.target.value)}>{LABOR_MEAL_REGIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field> : null}
                {trip.tripScope !== "local" ? <>
                  <Field label={trip.transportType === "corporate" ? "대표 수령 통행료·주차비 · 가는 길" : trip.transportType === "personal" ? "대표 수령 인정 운임 · 가는 길" : "대표 수령 실제 운임 · 가는 길"} hint={trip.fareSources?.outbound ? `${trip.fareSources.outbound.provider} · ${trip.fareSources.outbound.grade}` : "동반 출장 시 지정한 1명에게만 지급"}><input type="number" min="0" step="100" value={tripTransportFares(trip).outbound} onFocus={selectZeroNumber} onClick={selectZeroNumber} onChange={(event) => updateDirectionalFare("outbound", event.target.value)} /></Field>
                  <Field label={trip.transportType === "corporate" ? "대표 수령 통행료·주차비 · 오는 길" : trip.transportType === "personal" ? "대표 수령 인정 운임 · 오는 길" : "대표 수령 실제 운임 · 오는 길"} hint={trip.fareSources?.return ? `${trip.fareSources.return.provider} · ${trip.fareSources.return.grade}` : `가는 길과 다르면 별도 입력 · 합계 ${money(tripTransportFares(trip).total)}`}><input type="number" min="0" step="100" value={tripTransportFares(trip).return} onFocus={selectZeroNumber} onClick={selectZeroNumber} onChange={(event) => updateDirectionalFare("return", event.target.value)} /></Field>
                </> : null}
                <Field label="숙박 지역"><select value={trip.lodgingRegion} onChange={(event) => update("lodgingRegion", event.target.value)}><option value="seoul">서울 (상한 {money(LODGING_CAPS.seoul)})</option><option value="metro">광역시 (상한 {money(LODGING_CAPS.metro)})</option><option value="other">그 외 지역 (상한 {money(LODGING_CAPS.other)})</option></select></Field>
                <Field label="워크숍·교육 장기체류" wide hint={`이동 없는 중간 날짜의 일비를 ${Math.round(TRAVEL_POLICY.workshopMiddleDayRate * 100)}%로 계산합니다.`}>
                  <div className={styles.checkRow}><label><input type="checkbox" checked={trip.workshopStay} onChange={(event) => update("workshopStay", event.target.checked)} /><span>동일 장소에 3일 이상 체류</span></label></div>
                </Field>
              </div>
              <section className={styles.participantExpenseSection} aria-label="출장자별 여비 입력">
                <div className={styles.participantExpenseHeading}><strong>출장자별 정산</strong><span>숙박·감액·제공 식사는 사람별로 입력합니다.</span></div>
                <div className={styles.participantExpenseList}>
                  {expense.participantExpenses.map((item) => {
                    const participant = item.participant;
                    return (
                      <article key={participant.id} className={styles.participantExpenseCard}>
                        <div className={styles.participantExpenseTitle}><div><strong>{participant.employeeName || "출장자"}</strong><span>{participant.department} · {participant.position}</span></div>{participant.transportClaimant ? <b>교통비 대표</b> : <b className={styles.companionBadge}>동승자</b>}</div>
                        {trip.tripScope === "local" ? <p className={styles.localParticipantNote}>관내 출장은 별도 식비·숙박비 없이 일비 {money(item.perDiem)}만 적용됩니다.</p> : (
                          <div className={styles.participantExpenseInputs}>
                            <label><span>숙박 실제 소요액</span><input type="number" min="0" step="1000" value={participant.lodgingActual} onFocus={selectZeroNumber} onClick={selectZeroNumber} onChange={(event) => updateParticipant(participant.id, "lodgingActual", Number(event.target.value))} /></label>
                            <label><span>기타 감액</span><input type="number" min="0" step="100" value={participant.deduction} onFocus={selectZeroNumber} onClick={selectZeroNumber} onChange={(event) => updateParticipant(participant.id, "deduction", Number(event.target.value))} /></label>
                            <div className={styles.participantMealChecks}><span>식사 제공</span>{[["breakfast", "조식"], ["lunch", "중식"], ["dinner", "석식"]].map(([key, label]) => <label key={key}><input type="checkbox" checked={participant.mealsProvided[key]} onChange={(event) => updateParticipant(participant.id, "mealsProvided", { [key]: event.target.checked })} /><span>{label}</span></label>)}</div>
                          </div>
                        )}
                        <div className={styles.participantExpenseSummary}><span>운임 {money(item.transport)}</span><span>일비 {money(item.perDiem)}</span><span>숙박 {money(item.lodging)}</span><span>식비 {money(item.meal)}</span><strong>{money(item.total)}</strong></div>
                      </article>
                    );
                  })}
                </div>
              </section>
              {false ? (
                <section className={styles.fareLookup} aria-label="공공 교통 운임 조회">
                  <div className={styles.fareLookupHeader}>
                    <div><strong>공공데이터 교통 운임</strong><span>경유 구간별 TAGO 운임을 가는 길·오는 길 날짜로 각각 조회</span></div>
                    <div className={styles.fareLookupActions}><button type="button" onClick={() => lookupFares("outbound")} disabled={Boolean(busy)}>{busy === "fare-outbound" ? "조회 중…" : "가는 길 조회"}</button><button type="button" onClick={() => lookupFares("return")} disabled={Boolean(busy)}>{busy === "fare-return" ? "조회 중…" : "오는 길 조회"}</button></div>
                  </div>
                  {fareNotice ? <p className={styles.fareNotice}>{fareNotice}</p> : null}
                  {fareOptions.length ? (
                    <div className={styles.fareOptionGrid}>
                      {fareOptions.map((option) => (
                        <article className={option.recommended ? styles.fareRecommended : ""} key={option.id}>
                          <div><span>{option.provider}{option.recommended ? " · 추천" : ""}</span><strong>{option.departure} → {option.arrival}</strong><small>{option.grade}{option.departureTime ? ` · ${option.departureTime.slice(11, 16)} 출발` : ""}</small>{option.routeSegments?.length > 1 ? <small>{option.routeSegments.map((segment) => `${segment.departure}→${segment.arrival} ${money(segment.oneWayFare)}`).join(" · ")}</small> : null}</div>
                          <div><small>{fareDirection === "return" ? "오는 길" : "가는 길"}</small><b>{money(option.oneWayFare)}</b><button type="button" onClick={() => applyFare(option)}>이 운임 적용</button></div>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  <small className={styles.fareSourceNote}>출처: 공공데이터포털 국토교통부(TAGO). 조회 결과가 없으면 운임을 직접 입력할 수 있습니다.</small>
                </section>
              ) : null}
              <div className={styles.amountGrid}><AmountCard label="운임" value={expense.transport} note={trip.tripScope === "local" ? "관내 미지급" : `가는 길 ${money(tripTransportFares(trip).outbound)} + 오는 길 ${money(tripTransportFares(trip).return)}`} /><AmountCard label="일비" value={expense.perDiem} note={`${trip.participants.length}명 합계 · ${expense.days}일`} /><AmountCard label="숙박비" value={expense.lodging} note={`${trip.participants.length}명 · ${expense.nights}박 상한`} /><AmountCard label="식비" value={expense.meal} note={trip.tripScope === "local" ? "관내 미지급" : trip.projectType === "labor" && trip.laborMealRegion !== "outProvince" ? "도내 최대 2식" : "최대 3식"} /><AmountCard label="최종 지급액" value={expense.total} note={`전체 감액 ${money(expense.deduction)}`} accent /></div>
              {expense.warnings.length ? <ul className={styles.warningList}>{expense.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
              <div className={styles.panelFooter}><button type="button" className={styles.secondaryButton} onClick={() => setActiveSection("review")}>← 정보 수정</button><button type="button" className={styles.primaryButton} onClick={() => setActiveSection("report")}>복명서 작성 →</button></div>
            </section>
          ) : null}

          {activeSection === "report" ? (
            <section className={styles.panel}>
              <div className={styles.panelHeading}><div><p>STEP 03</p><h2>출장복명서 완성</h2><span>실제 수행 결과를 메모하면 내 PC의 Ollama가 행정문서 초안을 만듭니다.</span></div><em>A4 {trip.participants.length + Math.ceil(trip.participants.length / 5) + 1}장 준비</em></div>
              <Field label="공동 복명 대표자" wide hint="복명서에는 출장자 전원의 이름을 표시하고 선택한 사람이 복명자로 서명합니다."><select value={trip.reporterParticipantId} onChange={(event) => update("reporterParticipantId", event.target.value)}>{trip.participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.employeeName || "성명 미입력"} · {participant.department || "부서 미입력"}</option>)}</select></Field>
              <Field label="실제 수행 결과 메모 (AI 근거)" wide hint="협의한 내용, 확인 결과, 후속 조치를 사실대로 적어주세요. 메모에 없는 내용은 AI가 만들지 않습니다.">
                <textarea className={styles.reportNotes} rows="5" value={trip.reportNotes || ""} onChange={(event) => update("reportNotes", event.target.value)} placeholder={"예: 안전관리 담당자와 교육 일정 협의\n현장 위험요인 3건 확인\n다음 주까지 보완자료 공유 예정"} />
              </Field>
              <section className={styles.localAiPanel} aria-label="로컬 AI 출장복명 초안">
                <div className={styles.localAiIntro}>
                  <span className={styles.localAiMark}>AI</span>
                  <div><strong>내 PC의 Ollama로 초안 작성</strong><p>브라우저가 {LOCAL_AI_CONFIG.ollamaBaseUrl}의 Ollama에 직접 연결합니다. 출장 정보는 외부 AI 서버로 전송되지 않으며, Ollama가 연결되지 않으면 브라우저 로컬 AI로 전환합니다.</p></div>
                </div>
                <div className={styles.localAiAction}>
                  <div className={styles.aiStatus}>
                    <span>{aiProgress.text || (ollama.status === "connected" ? ollama.message : ollama.status === "checking" ? "Ollama 확인 중" : localAiSupported === false ? "Ollama 미연결 · 규칙형 초안 사용" : "Ollama 미연결 · 브라우저 Qwen 대체 사용")}</span>
                    {busy === "report-ai" ? <progress max="1" value={aiProgress.progress} aria-label="로컬 AI 모델 준비 진행률" /> : null}
                  </div>
                  <div className={styles.ollamaControls}>
                    {ollama.status === "connected" && ollama.models.length ? <select aria-label="Ollama 모델" value={ollama.model} onChange={(event) => changeOllamaModel(event.target.value)}>{ollama.models.map((model) => <option key={model.name} value={model.name}>{model.name}{model.parameterSize ? ` · ${model.parameterSize}` : ""}</option>)}</select> : null}
                    <button className={styles.ollamaRefresh} type="button" onClick={() => detectOllama({ notify: true })} disabled={Boolean(busy)}>Ollama 확인</button>
                    <button type="button" onClick={draftReport} disabled={Boolean(busy) || !String(trip.reportNotes || "").trim()}>{busy === "report-ai" ? `${Math.round(aiProgress.progress * 100)}% 작성 중…` : ollama.status === "connected" ? "Ollama 초안 작성" : localAiSupported === false ? "규칙형 초안 작성" : "로컬 AI 초안 작성"}</button>
                  </div>
                </div>
              </section>
              {trip.reportNeedsReview ? <div className={styles.reportReviewWarning}><span>출장 경로·일시·방문기관 등 복명서의 기준 정보가 바뀌었습니다. AI 초안을 다시 만들거나 기존 내용을 확인해 주세요.</span><button type="button" onClick={confirmReportReview}>내용 확인 완료</button></div> : null}
              <Field label="출장내용" wide hint={`AI 초안을 검토·수정하세요. A4 한 쪽에 맞춰 자동 축소하며 현재 ${reportLayoutMetrics(trip.reportContent).characters.toLocaleString("ko-KR")} / ${MAX_REPORT_CHARACTERS.toLocaleString("ko-KR")}자입니다.`}><textarea rows="10" maxLength={MAX_REPORT_CHARACTERS} value={trip.reportContent} onChange={(event) => updateReportContent(event.target.value)} /></Field>
              <div className={styles.reportApprovalNotice}><span>복명서 결재라인</span><strong>{reportApprovalLineForDocument(trip.reportApprovalLine).join(" → ")}</strong><a href="/account">환경 설정에서 변경</a></div>
              <div className={styles.documentPreview}>
                <div><span>01</span><strong>여비지급신청서</strong><small>출장자별 {trip.participants.length}부</small></div>
                <div><span>02</span><strong>여비지출명세서</strong><small>{Math.ceil(trip.participants.length / 5)}부 · 총 {money(expense.total)}</small></div>
                <div><span>03</span><strong>공동 출장복명서</strong><small>{trip.participants.map((participant) => participant.employeeName).filter(Boolean).join(", ") || "출장자"}</small></div>
              </div>
              <div className={styles.actionGrid}><button className={styles.saveButton} type="button" onClick={saveTrip} disabled={Boolean(busy)}>{busy === "save" ? "저장 중…" : "서류·원본 저장"}</button><button className={styles.excelButton} type="button" onClick={downloadExcel} disabled={Boolean(busy)}>{busy === "excel" ? "Excel 만드는 중…" : "Excel 다운로드"}</button><button className={styles.printButton} type="button" onClick={printTrip}>A4 인쇄 / PDF</button></div>
              <div className={styles.panelFooter}><button type="button" className={styles.secondaryButton} onClick={() => setActiveSection("expense")}>← 금액 수정</button></div>
            </section>
          ) : null}

        </div>
      </section>

      <section id="recent" className={styles.recentSection}>
        <div><p className={styles.eyebrow}>MY BUSINESS TRIPS</p><h2>내 출장 서류</h2><span>저장한 출장만 본인 계정에서 다시 볼 수 있습니다.</span></div>
        <div className={styles.recentList}>{recentTrips.length ? recentTrips.map((item) => <article key={item.id}><div><strong>{item.destination || "출장지 미입력"}</strong><span>{item.purpose || "출장목적 미입력"}{item.participant_count > 1 ? ` · ${item.participant_count}명 동반` : ""}</span></div><small>{String(item.start_at || "").slice(0, 10)}</small><b>{money(item.total_amount)}</b><button className={styles.deleteTripButton} type="button" onClick={() => deleteTrip(item)} disabled={Boolean(busy)} aria-label={`${String(item.start_at || "").slice(0, 10)} ${item.destination || "출장지 미입력"} 출장 삭제`}>{busy === `delete-${item.id}` ? "삭제 중…" : "삭제"}</button></article>) : <div className={styles.emptyRecent}>아직 저장한 출장 서류가 없습니다.</div>}</div>
      </section>

      <section id="policy" className={styles.policySection}>
        <div><p className={styles.eyebrow}>RULE ENGINE</p><h2>적용 중인 여비 기준</h2></div>
        <div><article><span>동반 출장</span><strong>교통비 1명</strong><p>신청서는 개인별 작성, 일비·식비는 전원 계산</p></article><article><span>일비·숙박</span><strong>규정 자동 적용</strong><p>법인차 {Math.round(TRAVEL_POLICY.corporateDailyRate * 100)}% · 숙박 지역별 실비 상한</p></article><article><span>식비</span><strong>{money(TRAVEL_POLICY.generalMealDailyCap)} / {money(TRAVEL_POLICY.laborMealDailyCap)}</strong><p>일반 3식 · 고용부 도내 최대 2식 기준</p></article></div>
      </section>

      <section id="ollama-guide" className={styles.ollamaGuide}>
        <div className={styles.ollamaGuideHeader}>
          <div><p className={styles.eyebrow}>PRIVATE LOCAL AI</p><h2>직원용 Ollama 설치 가이드</h2><span>출장복명서 초안을 PC 안에서 작성하려면 아래 순서대로 한 번만 설치해 주세요.</span></div>
          <div className={styles.ollamaGuideLinks}><a href="https://ollama.com/download/windows" target="_blank" rel="noreferrer">Windows 설치</a><a href="https://ollama.com/download/mac" target="_blank" rel="noreferrer">macOS 설치</a></div>
        </div>
        <div className={styles.ollamaSteps}>
          <article><b>01</b><h3>Ollama 설치</h3><p>사용 중인 PC에 맞는 설치 파일을 내려받아 설치합니다. 설치 후 Ollama 앱을 실행해 주세요.</p></article>
          <article><b>02</b><h3>Qwen 모델 받기</h3><p>터미널(Windows PowerShell 또는 macOS Terminal)에서 한 번 실행합니다.</p><pre><code>ollama pull {LOCAL_AI_CONFIG.ollamaPullModel}{`\n`}ollama list</code></pre></article>
          <article><b>03</b><h3>사이트에서 연결 확인</h3><p>출장복명서 작성 단계에서 <strong>Ollama 확인</strong>을 누릅니다. Qwen 모델이 목록에 나타나면 준비 완료입니다.</p><pre><code>ollama serve</code></pre></article>
          <article><b>04</b><h3>복명서 초안 작성</h3><p>실제 수행 메모를 입력하고 <strong>Ollama 초안 작성</strong>을 누릅니다. 입력한 출장 정보는 PC의 Ollama로 직접 전송됩니다.</p></article>
        </div>
        <div className={styles.ollamaTroubleshoot}><div><strong>연결이 안 될 때</strong><span>Ollama를 종료했다가 다시 실행하고, 아래 환경변수를 설정한 뒤 브라우저를 새로고침하세요.</span></div><pre><code>{`OLLAMA_ORIGINS=${ollamaAllowedOrigin || "https://your-domain.example"}`}</code></pre><small>Windows: 환경 변수에 추가 후 Ollama 재시작 · macOS: 터미널에서 설정 후 Ollama 재시작</small></div>
      </section>

      <footer className={styles.footer}>{APP_FOOTER}</footer>
      <PrintBundle trip={trip} expense={expense} />
    </main>
  );
}
