import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateTripExpense,
  fareGradeForDocument,
  tripRoutePoints,
  tripTransportFares,
} from "../lib/travel-rules.js";

test("hides recognized and manual fare labels only in document grade cells", () => {
  assert.equal(fareGradeForDocument("인정 운임"), "");
  assert.equal(fareGradeForDocument("수동운임"), "");
  assert.equal(fareGradeForDocument("우등"), "우등");
  assert.equal(fareGradeForDocument(""), "-");
});

function baseTrip(overrides = {}) {
  return {
    tripScope: "external",
    startAt: "2026-08-03T09:00",
    endAt: "2026-08-03T18:00",
    origin: "전주",
    destination: "남원 (방문기관)",
    transportDestination: "남원",
    transportType: "personal",
    projectType: "general",
    laborMealRegion: "inProvince",
    lodgingRegion: "other",
    outboundTransportActual: 22_000,
    returnTransportActual: 22_000,
    lodgingActual: 0,
    deduction: 0,
    mealsProvided: { breakfast: false, lunch: false, dinner: false },
    participants: [],
    ...overrides,
  };
}

test("uses directional preset metadata when the matching inputs are still zero", () => {
  const fares = tripTransportFares(baseTrip({
    outboundTransportActual: 0,
    returnTransportActual: 0,
    fareSources: {
      outbound: { oneWayFare: 22_000 },
      return: { oneWayFare: 23_000 },
    },
  }));

  assert.deepEqual(fares, { outbound: 22_000, return: 23_000, total: 45_000 });
});

test("preserves an explicit transport terminal but cleans a visit-location fallback", () => {
  assert.deepEqual(
    tripRoutePoints(baseTrip({
      origin: "광주",
      transportDestination: "광주(유·스퀘어)",
      waypoints: ["정읍"],
    })),
    ["광주", "정읍", "광주(유·스퀘어)"],
  );

  assert.deepEqual(
    tripRoutePoints(baseTrip({ transportDestination: "", destination: "남원 (사업단)" })),
    ["전주", "남원"],
  );
});

test("pays shared transport to only one participant", () => {
  const expense = calculateTripExpense(baseTrip({
    participants: [
      { id: "one", employeeName: "김하나", transportClaimant: true },
      { id: "two", employeeName: "이두리", transportClaimant: true },
    ],
  }));

  assert.equal(expense.transport, 44_000);
  assert.equal(expense.participantExpenses[0].transport, 44_000);
  assert.equal(expense.participantExpenses[1].transport, 0);
});

test("applies the 50 percent middle-day allowance for a four-day workshop", () => {
  const expense = calculateTripExpense(baseTrip({
    startAt: "2026-08-03T09:00",
    endAt: "2026-08-06T18:00",
    workshopStay: true,
  }));

  assert.equal(expense.days, 4);
  assert.equal(expense.perDiem, 75_000);
});

test("applies the labor-project two-meal daily cap and provided-meal deductions", () => {
  const full = calculateTripExpense(baseTrip({
    projectType: "labor",
    laborMealRegion: "inProvince",
  }));
  const provided = calculateTripExpense(baseTrip({
    projectType: "labor",
    laborMealRegion: "inProvince",
    mealsProvided: { breakfast: false, lunch: true, dinner: true },
  }));

  assert.equal(full.meal, 16_800);
  assert.equal(provided.meal, 0);
});

test("applies the corporate-car 50 percent daily allowance", () => {
  const expense = calculateTripExpense(baseTrip({ transportType: "corporate" }));

  assert.equal(expense.perDiem, 12_500);
  assert.match(expense.ruleSummary, /50%/);
});
