import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedApprovalTitlePreference,
  allowedOriginPreference,
  approvalLinePreferenceValidationError,
  initialReportApprovalLine,
  initialTripOrigin,
  originPreferenceValidationError,
  reportApprovalLineForDocument,
  travelUserPreferenceConfigured,
} from "../lib/travel-user-preferences.js";

const bases = ["전주", "군산", "부안"];

test("accepts only an office in the configured departure base list", () => {
  assert.equal(allowedOriginPreference(" 군산 ", bases), "군산");
  assert.equal(allowedOriginPreference("익산", bases), "");
});

const approvalTitles = ["팀장", "실장", "국장", "원장"];

test("accepts only configured report approver titles", () => {
  assert.equal(allowedApprovalTitlePreference(" 실장 ", approvalTitles), "실장");
  assert.equal(allowedApprovalTitlePreference("이사장", approvalTitles), "");
});

test("requires two distinct configured report approvers", () => {
  assert.equal(approvalLinePreferenceValidationError(["국장", "원장"], approvalTitles), "");
  assert.equal(approvalLinePreferenceValidationError(["실장", "원장"], approvalTitles), "");
  assert.equal(approvalLinePreferenceValidationError(["실장", "실장"], approvalTitles), "1차 결재자와 최종 결재자는 서로 다르게 선택해 주세요.");
  assert.equal(approvalLinePreferenceValidationError(["실장", "이사장"], approvalTitles), "기관에서 사용하는 결재자 직위 중에서 선택해 주세요.");
});

test("uses a saved report approval line and falls back to configured titles", () => {
  assert.deepEqual(initialReportApprovalLine(["팀장", "원장"], approvalTitles), ["팀장", "원장"]);
  assert.deepEqual(initialReportApprovalLine(["팀장", "이사장"], approvalTitles), ["팀장", "실장"]);
  assert.deepEqual(initialReportApprovalLine(["팀장", "이사장"], ["팀장", "센터장"]), ["팀장", "센터장"]);
});

test("keeps a historical report approval line even when the current option list changes", () => {
  assert.deepEqual(reportApprovalLineForDocument(["사업부장", "이사장"]), ["사업부장", "이사장"]);
  assert.deepEqual(reportApprovalLineForDocument(["원장", "원장"]), ["팀장", "실장"]);
});

test("requires a configured departure office", () => {
  assert.equal(originPreferenceValidationError("", bases), "기본 출발 기준지를 선택해 주세요.");
  assert.equal(originPreferenceValidationError("정읍", bases), "운영 중인 기준지 목록에서 선택해 주세요.");
  assert.equal(originPreferenceValidationError("부안", bases), "");
});

test("uses a saved preference for a new trip and otherwise waits for selection", () => {
  assert.equal(initialTripOrigin("군산", bases), "군산");
  assert.equal(initialTripOrigin("익산", bases), "");
  assert.equal(initialTripOrigin("", ["전주"]), "전주");
});

test("기준지와 서로 다른 결재자 2명을 저장한 시점부터 첫 설정 완료로 본다", () => {
  const configured = {
    default_origin: "군산",
    report_approver_first: "국장",
    report_approver_second: "원장",
    report_approval_configured_at: "2026-08-19T00:00:00.000Z",
  };
  assert.equal(travelUserPreferenceConfigured(configured, bases, approvalTitles), true);
  assert.equal(travelUserPreferenceConfigured({ ...configured, report_approval_configured_at: null }, bases, approvalTitles), false);
  assert.equal(travelUserPreferenceConfigured({ ...configured, default_origin: "정읍" }, bases, approvalTitles), false);
  assert.equal(travelUserPreferenceConfigured({ ...configured, report_approver_first: "원장" }, bases, approvalTitles), false);
});
