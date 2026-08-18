import test from "node:test";
import assert from "node:assert/strict";
import { fareLocationMatchScore, findAutomaticFareMatch } from "../lib/travel-fare-matching.js";

const baseTrip = {
  origin: "전주",
  destination: "전북특별자치도 남원 (샘플기관)",
  transportType: "personal",
  tripScope: "domestic",
};

test("출장지와 기준표의 지역 단어가 같으면 터미널명을 숨긴 채 운임을 매칭한다", () => {
  const preset = {
    origin: "전주시외버스터미널",
    destination: "남원시외버스터미널",
    outbound_fare: 6_900,
    return_fare: 7_200,
    scope: "global",
  };
  const result = findAutomaticFareMatch(baseTrip, [preset]);
  assert.equal(result.preset, preset);
  assert.equal(result.ambiguous, false);
  assert.ok(fareLocationMatchScore(baseTrip.destination, preset.destination) > 0);
});

test("같은 지역 단어에 금액이 다른 최상위 노선이 여럿이면 임의 적용하지 않는다", () => {
  const trip = { ...baseTrip, destination: "서울 업무협의" };
  const result = findAutomaticFareMatch(trip, [
    { origin: "전주", destination: "서울", outbound_fare: 20_000, return_fare: 20_000 },
    { origin: "전주", destination: "서울", outbound_fare: 22_000, return_fare: 22_000 },
  ]);
  assert.equal(result.preset, null);
  assert.equal(result.ambiguous, true);
  assert.equal(result.candidates.length, 2);
});

test("최상위 후보 금액이 같으면 공용 기준표를 우선 적용한다", () => {
  const trip = { ...baseTrip, destination: "서울 업무협의" };
  const personal = { origin: "전주", destination: "서울", outbound_fare: 20_000, return_fare: 20_000, scope: "personal" };
  const global = { origin: "전주", destination: "서울", outbound_fare: 20_000, return_fare: 20_000, scope: "global" };
  const result = findAutomaticFareMatch(trip, [personal, global]);
  assert.equal(result.preset, global);
  assert.equal(result.ambiguous, true);
});

test("법인차와 근무지내 출장은 저장 운임을 자동 적용하지 않는다", () => {
  const preset = { origin: "전주", destination: "남원", outbound_fare: 6_900, return_fare: 6_900 };
  assert.equal(findAutomaticFareMatch({ ...baseTrip, transportType: "corporate" }, [preset]).preset, null);
  assert.equal(findAutomaticFareMatch({ ...baseTrip, tripScope: "local" }, [preset]).preset, null);
});
