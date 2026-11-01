import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { findAutomaticFareMatch } from "../lib/travel-fare-matching.js";

const data = JSON.parse(fs.readFileSync(new URL("../config/bus-fare-additions-2026-11-01.json", import.meta.url), "utf8"));
const presets = data.additions.flatMap(({ origin, destination, previousFare, fare }) => [
  { origin, destination, outbound_fare: previousFare, return_fare: previousFare, effective_from: "0001-01-01", effective_until: "2026-10-01" },
  { origin, destination, outbound_fare: fare, return_fare: fare, effective_from: "2026-10-01", effective_until: null },
]);

function fareOn(origin, destination, date) {
  const { preset } = findAutomaticFareMatch({ transportType: "public", tripScope: "domestic", origin, destination, startAt: `${date}T09:00`, endAt: `${date}T18:00` }, presets);
  return preset?.outbound_fare;
}

test("비교표 신규 28개 노선은 09. 30.까지 변경 전, 10. 01.부터 변경 후 요금을 쓴다", () => {
  assert.equal(data.additions.length, 28);
  for (const { origin, destination, previousFare, fare } of data.additions) {
    assert.equal(fareOn(origin, destination, "2026-09-30"), previousFare, `${origin}-${destination} 변경 전`);
    assert.equal(fareOn(origin, destination, "2026-10-01"), fare, `${origin}-${destination} 변경 후`);
    assert.equal(fareOn(destination, origin, "2026-10-01"), fare, `${destination}-${origin} 역방향`);
  }
});

test("직행과 우등이 함께 있는 구간은 우등 요금으로 등록한다", () => {
  const byRoute = Object.fromEntries(data.additions.map((row) => [`${row.origin}-${row.destination}`, row]));
  assert.equal(byRoute["전주-수원"].grade, "우등");
  assert.equal(byRoute["전주-수원"].fare, 22200);
  assert.equal(byRoute["전주-포항"].fare, 35300);
  assert.equal(byRoute["전주-창원"].grade, "직행");
  assert.equal(byRoute["전주-창원"].fare, 18900);
});
