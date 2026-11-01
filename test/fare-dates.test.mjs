import test from "node:test";
import assert from "node:assert/strict";
import { fareDate, clearPresetFareForDateChange } from "../lib/fare-dates.js";
import { findAutomaticFareMatch } from "../lib/travel-fare-matching.js";
import { tripTransportFares } from "../lib/travel-rules.js";

const oldFare = { origin: "전주", destination: "군산", outbound_fare: 6600, return_fare: 6600, effective_from: "0001-01-01" };
const newFare = { ...oldFare, outbound_fare: 7200, return_fare: 7300, effective_from: "2026-10-01" };
const trip = (startAt, endAt = startAt) => ({ origin: "전주", destination: "군산", transportType: "personal", tripScope: "domestic", startAt, endAt });
const match = (start, end, fares = [newFare, oldFare]) => findAutomaticFareMatch(trip(start, end), fares).preset;

test("9월 30일은 이전 운임, 10월 1일 0시부터는 새 운임을 적용한다", () => {
  assert.equal(match("2026-09-30T23:59").outbound_fare, 6600);
  assert.equal(match("2026-10-01T00:00").outbound_fare, 7200);
  assert.equal(match("2026-10-02").return_fare, 7300);
});

test("인상일을 사이에 둔 왕복은 각 이동일의 금액을 합산한다", () => {
  const result = match("2026-09-30T09:00", "2026-10-01T18:00");
  assert.equal(result.outbound_fare, 6600);
  assert.equal(result.return_fare, 7300);
  assert.equal(result.outboundEffectiveFrom, "0001-01-01");
  assert.equal(result.returnEffectiveFrom, "2026-10-01");
  assert.deepEqual(tripTransportFares({ outboundTransportActual: result.outbound_fare, returnTransportActual: result.return_fare }), { outbound: 6600, return: 7300, total: 13900 });
});

test("역방향 출장도 날짜별 이력을 고른 뒤 방향별 금액을 뒤집는다", () => {
  const result = findAutomaticFareMatch({ ...trip("2026-09-30", "2026-10-01"), origin: "군산", destination: "전주" }, [oldFare, newFare]).preset;
  assert.equal(result.outbound_fare, 6600);
  assert.equal(result.return_fare, 7200);
});

test("출장일보다 미래 요금밖에 없거나 날짜가 없으면 임의로 적용하지 않는다", () => {
  assert.equal(match("2026-09-30", undefined, [newFare]), null);
  assert.equal(match("", "2026-10-01"), null);
  assert.equal(match("2026-10-02", "2026-10-01"), null);
  assert.equal(match("2026-02-30"), null);
});

test("여러 번 인상되어도 해당 날짜까지의 가장 최근 이력을 사용한다", () => {
  const later = { ...newFare, outbound_fare: 9000, effective_from: "2027-01-01" };
  assert.equal(match("2026-12-31", undefined, [later, oldFare, newFare]).outbound_fare, 7200);
  assert.equal(match("2027-01-01", undefined, [newFare, later, oldFare]).outbound_fare, 9000);
});

test("적용이 끝난 과거 운임으로 미확인 인상 요금을 대신 계산하지 않는다", () => {
  const ended = { ...oldFare, effective_until: "2026-10-01" };
  assert.equal(match("2026-09-30", undefined, [ended]).outbound_fare, 6600);
  const result = findAutomaticFareMatch(trip("2026-10-01"), [ended]);
  assert.equal(result.preset, null);
  assert.equal(result.unavailableDate, true);
  assert.equal(match("2026-09-30", "2026-10-01", [ended]), null);
});

test("시트의 시·군 표기와 기존 지역명이 달라도 같은 노선의 최신 이력을 쓴다", () => {
  const named = { ...newFare, origin: "전주시", destination: "군산시" };
  assert.equal(match("2026-10-01", undefined, [oldFare, named]).outbound_fare, 7200);
});

test("같은 적용일의 상충하는 금액은 자동 선택하지 않는다", () => {
  const result = findAutomaticFareMatch(trip("2026-10-01"), [newFare, { ...newFare, outbound_fare: 8000 }]);
  assert.equal(result.preset, null);
  assert.equal(result.ambiguous, true);
});

test("출장일 변경 시 기준표 운임을 초기화하고 직접 입력한 금액은 보존한다", () => {
  const source = { sourceType: "preset", provider: "저장된 대중교통 운임", oneWayFare: 6600 };
  const dated = { ...trip("2026-09-30"), transportActual: 13200, outboundTransportActual: 6600, returnTransportActual: 6600, fareSource: source, fareSources: { outbound: source, return: source } };
  assert.equal(tripTransportFares(clearPresetFareForDateChange(dated)).total, 0);
  const manual = { ...dated, fareSource: { sourceType: "manual", provider: "직접 입력" }, fareSources: {} };
  assert.equal(clearPresetFareForDateChange(manual), manual);
  const mixed = { ...dated, outboundTransportActual: 8500, fareSources: { outbound: manual.fareSource, return: source } };
  const cleared = clearPresetFareForDateChange(mixed);
  assert.equal(cleared.outboundTransportActual, 8500);
  assert.equal(cleared.returnTransportActual, 0);
  assert.equal(cleared.fareSources.outbound.provider, "직접 입력");
  assert.equal(fareDate("2024-02-29T09:00"), "2024-02-29");
  assert.equal(fareDate("2026-02-29"), "");
});
