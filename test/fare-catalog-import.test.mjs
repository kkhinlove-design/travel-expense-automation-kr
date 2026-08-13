import assert from "node:assert/strict";
import test from "node:test";
import { parseFareCatalogRows, routeKey } from "../lib/fare-catalog-import.js";

test("accepts aliases and changed column order", () => {
  const rows = [
    ["기관 공용 운임표"],
    ["도착지", "오는 길 운임", "출발지", "가는 길 운임"],
    ["서울고속버스터미널", "7,200원", "전주시외버스터미널", "6,900원"],
  ];
  assert.deepEqual(parseFareCatalogRows(rows), [
    {
      origin: "전주시외버스터미널",
      destination: "서울고속버스터미널",
      outboundFare: 6900,
      returnFare: 7200,
      rowNumber: 3,
    },
  ]);
});

test("reports the row number for a duplicated route", () => {
  const rows = [
    ["출발지", "도착지", "가는 길 운임", "오는 길 운임"],
    ["전주", "서울", 6900, 7200],
    ["전주", "서울", 6900, 7200],
  ];
  assert.throws(() => parseFareCatalogRows(rows), /3행: 같은 출발지·도착지가 중복됩니다/);
});

test("rejects a fare that is not a whole number of won", () => {
  const rows = [
    ["출발지", "도착지", "가는 길 운임", "오는 길 운임"],
    ["전주", "서울", "육천구백", 7200],
  ];
  assert.throws(() => parseFareCatalogRows(rows), /운임은 0~10,000,000원 정수/);
});

test("keeps one direction optional but requires at least one fare", () => {
  const rows = [
    ["출발지", "도착지", "가는 길 운임", "오는 길 운임"],
    ["전주", "서울", 6900, 0],
    ["대전", "부산", 0, 0],
  ];
  assert.throws(() => parseFareCatalogRows(rows), /3행: 가는 길 또는 오는 길 운임/);
});

test("does not merge routes whose names contain spaces", () => {
  // "가 나" → "다"와 "가" → "나 다"가 같은 키로 뭉치면 한쪽이 중복으로 잘린다.
  assert.notEqual(routeKey("가 나", "다"), routeKey("가", "나 다"));
});
