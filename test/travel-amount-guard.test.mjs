import assert from "node:assert/strict";
import test from "node:test";
import { calculateTripExpense, tripAmountIssues, wonAmount } from "../lib/travel-rules.js";

function baseTrip(overrides = {}) {
  return {
    tripScope: "external",
    transportType: "public",
    projectType: "general",
    startAt: "2026-08-03T09:00",
    endAt: "2026-08-04T18:00",
    origin: "전주",
    destination: "서울",
    lodgingRegion: "seoul",
    outboundTransportActual: 6900,
    returnTransportActual: 7200,
    participants: [{ id: "p1", employeeName: "홍길동", transportClaimant: true, lodgingActual: 0, deduction: 0 }],
    ...overrides,
  };
}

function withLodging(value) {
  return baseTrip({
    participants: [{ id: "p1", employeeName: "홍길동", transportClaimant: true, lodgingActual: value, deduction: 0 }],
  });
}

test("tells apart an empty amount from one that cannot be read", () => {
  assert.deepEqual(wonAmount(""), { won: 0, issue: null });
  assert.deepEqual(wonAmount(undefined), { won: 0, issue: null });
  assert.deepEqual(wonAmount(100000), { won: 100000, issue: null });
  assert.deepEqual(wonAmount("100,000"), { won: 0, issue: "notNumeric" });
  assert.deepEqual(wonAmount("100000원"), { won: 0, issue: "notNumeric" });
  assert.deepEqual(wonAmount(-50000), { won: 0, issue: "negative" });
  assert.deepEqual(wonAmount(12_000_000), { won: 10_000_000, issue: "capped" });
});

test("warns instead of silently dropping an unreadable lodging amount", () => {
  const expense = calculateTripExpense(withLodging("100,000"));
  assert.equal(expense.lodging, 0);
  assert.ok(
    expense.warnings.some((warning) => warning.includes("홍길동의 숙박 실제 소요액") && warning.includes("0원으로 계산")),
    `경고가 없습니다: ${JSON.stringify(expense.warnings)}`,
  );
});

test("warns when an amount is negative or above the cap", () => {
  const negative = calculateTripExpense(baseTrip({
    participants: [{ id: "p1", employeeName: "홍길동", transportClaimant: true, lodgingActual: 0, deduction: -50000 }],
  }));
  assert.equal(negative.deduction, 0);
  assert.ok(negative.warnings.some((warning) => warning.includes("음수")));

  const capped = calculateTripExpense(withLodging(12_000_000));
  assert.ok(capped.warnings.some((warning) => warning.includes("상한")));
});

test("stays quiet for amounts that are simply zero or blank", () => {
  assert.deepEqual(tripAmountIssues(withLodging(0)), []);
  assert.deepEqual(tripAmountIssues(withLodging("")), []);
  assert.deepEqual(tripAmountIssues(withLodging(100000)), []);
});

test("checks the trip-level amount the first traveller inherits", () => {
  const trip = baseTrip({
    lodgingActual: "100,000",
    participants: [{ id: "p1", employeeName: "홍길동", transportClaimant: true, deduction: 0 }],
  });
  assert.ok(tripAmountIssues(trip).some((warning) => warning.includes("숙박 실제 소요액")));
});

test("flags a fare that cannot be read", () => {
  const trip = baseTrip({ outboundTransportActual: "6,900" });
  assert.ok(tripAmountIssues(trip).some((warning) => warning.includes("가는 길 운임")));
});
