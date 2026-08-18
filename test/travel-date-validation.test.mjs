import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  calculateTripExpense,
  tripDateValidationError,
  tripDayCount,
  tripDurationHours,
  tripRequiredInformationValidationError,
} from "../lib/travel-rules.js";

function completeTrip(overrides = {}) {
  return {
    tripScope: "external",
    purpose: "협력기관 업무 협의",
    destination: "남원 사업단",
    startAt: "2026-08-03T09:00",
    endAt: "2026-08-03T18:00",
    origin: "전주",
    transportDestination: "남원",
    transportType: "personal",
    projectType: "general",
    lodgingRegion: "other",
    outboundTransportActual: 6_900,
    returnTransportActual: 6_900,
    participants: [{
      id: "primary",
      department: "기업성장실",
      position: "2급",
      employeeName: "고경환",
      transportClaimant: true,
      lodgingActual: 0,
      deduction: 0,
    }],
    ...overrides,
  };
}

test("출장 일시의 누락·잘못된 달력값·역전을 구분해 막는다", () => {
  assert.match(tripDateValidationError("", "2026-08-03T18:00"), /모두 입력/);
  assert.match(tripDateValidationError("2026-02-30T09:00", "2026-03-01T18:00"), /형식이 올바르지/);
  assert.match(tripDateValidationError("2026-08-03T25:00", "2026-08-04T18:00"), /형식이 올바르지/);
  assert.match(tripDateValidationError("2026-08-04T09:00", "2026-08-03T18:00"), /늦어야/);
  assert.match(tripDateValidationError("2026-08-03T09:00", "2026-08-03T09:00"), /늦어야/);
  assert.equal(tripDateValidationError("2026-08-03T09:00", "2026-08-03T18:00"), "");
});

test("유효하지 않은 일시는 하루 출장으로 보정하지 않고 여비 전체를 0원으로 차단한다", () => {
  const trip = completeTrip({ startAt: "2026-08-04T09:00", endAt: "2026-08-03T18:00" });
  const expense = calculateTripExpense(trip);

  assert.equal(tripDayCount(trip.startAt, trip.endAt), 0);
  assert.equal(tripDurationHours(trip.startAt, trip.endAt), 0);
  assert.equal(expense.days, 0);
  assert.equal(expense.transport, 0);
  assert.equal(expense.perDiem, 0);
  assert.equal(expense.lodging, 0);
  assert.equal(expense.meal, 0);
  assert.equal(expense.total, 0);
  assert.match(expense.ruleSummary, /일시 확인/);
  assert.ok(expense.warnings.some((warning) => warning.includes("여비를 계산하지 않습니다")));
});

test("저장 필수정보는 모든 출장자의 부서·직위·성명과 목적·출장지를 확인한다", () => {
  assert.equal(tripRequiredInformationValidationError(completeTrip()), "");
  assert.match(tripRequiredInformationValidationError(completeTrip({ purpose: "" })), /출장 목적/);
  assert.match(tripRequiredInformationValidationError(completeTrip({ destination: "" })), /출장지/);
  assert.match(tripRequiredInformationValidationError(completeTrip({
    participants: [
      completeTrip().participants[0],
      { department: "기업성장실", position: "", employeeName: "김희은" },
    ],
  })), /김희은의 직급\/직위/);
});

test("출장 저장 POST는 공용 필수정보·날짜 검증 뒤에만 계산한다", async () => {
  const routePath = fileURLToPath(new URL("../app/api/travel/trips/route.js", import.meta.url));
  const source = await readFile(routePath, "utf8");
  const postBody = source.slice(source.indexOf("export async function POST"));
  const requiredIndex = postBody.indexOf("tripRequiredInformationValidationError(trip)");
  const dateIndex = postBody.indexOf("tripDateValidationError(trip.startAt, trip.endAt)");
  const calculationIndex = postBody.indexOf("calculateTripExpense(trip)");

  assert.ok(requiredIndex >= 0, "저장 API에 필수 출장정보 검증이 없습니다.");
  assert.ok(dateIndex > requiredIndex, "저장 API에 공용 날짜 검증이 없습니다.");
  assert.ok(calculationIndex > dateIndex, "검증 전에 여비를 계산하고 있습니다.");
});
