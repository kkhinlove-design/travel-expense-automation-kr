import assert from "node:assert/strict";
import test from "node:test";

import {
  participantTravelTransportLabel,
  shouldShowTravelLodgingCap,
  travelDestinationRegion,
  travelTransportLabel,
} from "../lib/travel-document-format.js";

test("방문기관과 목적이 포함된 출장지는 지역명만 표시한다", () => {
  assert.equal(travelDestinationRegion("전북 군산 식품일자리센터 실적보고 협의"), "군산");
  assert.equal(travelDestinationRegion("전북특별자치도 남원시 (남원 사업단)"), "남원");
  assert.equal(travelDestinationRegion("서울특별시 한국산업단지공단"), "서울");
  assert.equal(travelDestinationRegion("대전 정부청사"), "대전");
  assert.equal(travelDestinationRegion("전주시외버스터미널※승차"), "전주");
  assert.equal(travelDestinationRegion("군산-식품센터"), "군산");
  assert.equal(travelDestinationRegion("춘천시청/별관"), "춘천");
});

test("숙박비 상한은 실제 숙박비를 청구한 경우에만 표시한다", () => {
  assert.equal(shouldShowTravelLodgingCap({ lodging: 70_000 }), true);
  assert.equal(shouldShowTravelLodgingCap({ lodging: 0 }), false);
  assert.equal(shouldShowTravelLodgingCap({ lodging: undefined }), false);
});

test("법인차 비용 대표가 아닌 출장자는 법인차 동승으로 표시한다", () => {
  assert.equal(participantTravelTransportLabel({ transportType: "corporate" }, { transportClaimant: true }), "법인차");
  assert.equal(participantTravelTransportLabel({ transportType: "corporate" }, { transportClaimant: false }), "법인차(동승)");
  assert.equal(participantTravelTransportLabel({ transportType: "personal" }, { transportClaimant: false }), "개인차");
  assert.equal(travelTransportLabel("public"), "대중교통");
});
