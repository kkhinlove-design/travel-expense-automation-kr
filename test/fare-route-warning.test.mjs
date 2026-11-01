import test from "node:test";
import assert from "node:assert/strict";
import { findFareRouteWarning } from "../lib/travel-fare-matching.js";

const fare = (origin, destination) => ({ origin, destination, outbound_fare: 10000, return_fare: 10000, effective_from: "2026-10-01", effective_until: null });
const presets = [fare("전주", "인천공항"), fare("군산", "대구서부"), fare("전주", "수원"), fare("전주", "군산"), fare("전주", "서울")];
const warning = (origin, destination) => findFareRouteWarning({ transportType: "public", tripScope: "domestic", origin, destination, startAt: "2026-10-01T09:00", endAt: "2026-10-01T18:00" }, presets);

test("입력 지명보다 좁은 노선으로 찾으면 경고한다", () => {
  assert.deepEqual(warning("전주", "인천"), { inputWord: "인천", presetLocation: "인천공항" });
  assert.deepEqual(warning("전주", "인천광역시 송도"), { inputWord: "인천", presetLocation: "인천공항" });
  assert.deepEqual(warning("군산", "대구"), { inputWord: "대구", presetLocation: "대구서부" });
});

test("역방향 노선에서도 입력한 쪽 지명을 경고한다", () => {
  assert.deepEqual(warning("인천", "전주"), { inputWord: "인천", presetLocation: "인천공항" });
});

test("같은 곳이거나 입력이 더 구체적이면 경고하지 않는다", () => {
  assert.equal(warning("전주", "인천공항"), null);
  assert.equal(warning("전주", "인천 공항"), null);
  assert.equal(warning("전주", "인천공항 제2터미널"), null);
  assert.equal(warning("전주", "수원시청"), null);
  assert.equal(warning("전주", "서울 코엑스"), null);
  assert.equal(warning("군산", "전주시 전북(테크노파크)"), null);
});

test("적용된 노선이 없으면 경고하지 않는다", () => {
  assert.equal(warning("전주", "부산"), null);
});
