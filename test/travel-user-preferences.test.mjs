import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedOriginPreference,
  initialTripOrigin,
  originPreferenceValidationError,
} from "../lib/travel-user-preferences.js";

const bases = ["전주", "군산", "부안"];

test("accepts only an office in the configured departure base list", () => {
  assert.equal(allowedOriginPreference(" 군산 ", bases), "군산");
  assert.equal(allowedOriginPreference("익산", bases), "");
});

test("requires a configured departure office", () => {
  assert.equal(originPreferenceValidationError("", bases), "기본 출발 사무소를 선택해 주세요.");
  assert.equal(originPreferenceValidationError("정읍", bases), "운영 중인 사무소 목록에서 출발 기준지를 선택해 주세요.");
  assert.equal(originPreferenceValidationError("부안", bases), "");
});

test("uses a saved preference for a new trip and otherwise waits for selection", () => {
  assert.equal(initialTripOrigin("군산", bases), "군산");
  assert.equal(initialTripOrigin("익산", bases), "");
  assert.equal(initialTripOrigin("", ["전주"]), "전주");
});
