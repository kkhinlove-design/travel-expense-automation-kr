import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  filterTravelRecords,
  isTravelRecordCompleted,
  paginateTravelRecords,
  safeTravelTimestamp,
  travelRecordCounts,
} from "../lib/travel-ledger.js";

const records = [
  { id: "approved", status: "approved" },
  { id: "legacy", status: "saved" },
  { id: "complete", status: "completed" },
];

test("승인 등록과 완료 기록을 구분해 누락 점검 집계를 만든다", () => {
  assert.equal(isTravelRecordCompleted(records[0]), false);
  assert.equal(isTravelRecordCompleted(records[1]), true);
  assert.deepEqual(travelRecordCounts(records), { total: 3, pending: 1, completed: 2 });
  assert.deepEqual(filterTravelRecords(records, "pending").map((item) => item.id), ["approved"]);
  assert.deepEqual(filterTravelRecords(records, "completed").map((item) => item.id), ["legacy", "complete"]);
});

test("대장 자동 등록은 불완전한 일시를 DB timestamp에 넣지 않는다", () => {
  assert.equal(safeTravelTimestamp("2026-08-05T09:00"), "2026-08-05T09:00");
  assert.equal(safeTravelTimestamp(""), null);
  assert.equal(safeTravelTimestamp("확인 필요"), null);
});

test("출장 API와 화면은 파일 저장 없이 승인 기록·정산 완료·불러오기를 연결한다", async () => {
  const route = await readFile(new URL("../app/api/travel/trips/route.js", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../app/travel/travel-workspace.js", import.meta.url), "utf8");
  assert.match(route, /register-approved/);
  assert.match(route, /TRAVEL_RECORD_STATUS\.approved/);
  assert.match(route, /TRAVEL_RECORD_STATUS\.completed/);
  assert.match(route, /\.limit\(200\)/);
  assert.match(route, /\.eq\("document_number", String\(trip\.documentNumber\)\.trim\(\)\)/);
  assert.doesNotMatch(route, /uploadTravelSourceObject|uploadSource\(/);
  assert.match(workspace, /registerApprovedTrip/);
  assert.match(workspace, /loadTripFromLedger/);
  assert.match(workspace, /내 출장대장 · 누락 점검/);
  assert.match(workspace, /정산 완료/);
  assert.doesNotMatch(workspace, /formData\.set\("approvedPdf"|formData\.set\("sourceHwpx"/);
});

test("출장대장은 10건씩 나누고 범위를 벗어난 페이지는 마지막 페이지로 맞춘다", () => {
  const list = Array.from({ length: 23 }, (_, index) => ({ id: index + 1 }));
  const first = paginateTravelRecords(list, 1);
  assert.deepEqual([first.items.length, first.pageCount, first.from, first.to, first.total], [10, 3, 1, 10, 23]);
  const last = paginateTravelRecords(list, 3);
  assert.deepEqual(last.items.map((item) => item.id), [21, 22, 23]);
  assert.deepEqual([last.from, last.to], [21, 23]);
  assert.equal(paginateTravelRecords(list.slice(0, 20), 3).page, 2);
  assert.equal(paginateTravelRecords(list, 0).page, 1);
  assert.equal(paginateTravelRecords(list.slice(0, 10), 1).pageCount, 1);
  assert.deepEqual([paginateTravelRecords([], 1).pageCount, paginateTravelRecords([], 1).from, paginateTravelRecords([], 1).to], [1, 0, 0]);
});
