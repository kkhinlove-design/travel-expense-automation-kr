import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_ORIGIN_BASES, parseOriginBases } from "../config/organization.js";

test("provides the eleven Jeonbuk office departure bases", () => {
  assert.deepEqual(DEFAULT_ORIGIN_BASES, [
    "전주",
    "군산",
    "김제",
    "남원",
    "완주",
    "진안",
    "무주",
    "장수",
    "임실",
    "고창",
    "부안",
  ]);
  assert.equal(DEFAULT_ORIGIN_BASES.includes("정읍"), false);
  assert.equal(DEFAULT_ORIGIN_BASES.includes("익산"), false);
  assert.equal(DEFAULT_ORIGIN_BASES.includes("순창"), false);
});

test("accepts a comma separated organization-specific departure base list", () => {
  assert.deepEqual(parseOriginBases(" 서울 본부, 부산 지사;서울 본부\n대전 사무소 "), [
    "서울 본부",
    "부산 지사",
    "대전 사무소",
  ]);
});
