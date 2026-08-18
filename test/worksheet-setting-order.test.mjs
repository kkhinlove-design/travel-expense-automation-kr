import assert from "node:assert/strict";
import test from "node:test";
import { worksheetSettingIndex } from "../lib/travel-excel.js";

// 삽입 위치를 실제로 적용해 본 결과 순서를 만든다.
function insert(existing, name) {
  const next = [...existing];
  next.splice(worksheetSettingIndex(existing, name), 0, name);
  return next;
}

test("puts printOptions before an existing pageMargins", () => {
  // 여비지출명세서가 이 모양이다. 뒤에 꼬리 요소가 하나도 없어서
  // 예전 구현은 printOptions를 맨 끝에 붙였고 Excel이 시트를 버렸다.
  const sheet = ["sheetViews", "sheetFormatPr", "cols", "sheetData", "mergeCells", "pageMargins"];
  assert.deepEqual(insert(sheet, "printOptions"), [
    "sheetViews", "sheetFormatPr", "cols", "sheetData", "mergeCells", "printOptions", "pageMargins",
  ]);
});

test("puts sheetPr first so fit-to-page metadata keeps the worksheet schema order", () => {
  const sheet = ["dimension", "sheetViews", "sheetData", "pageMargins", "pageSetup"];
  assert.deepEqual(insert(sheet, "sheetPr"), [
    "sheetPr", "dimension", "sheetViews", "sheetData", "pageMargins", "pageSetup",
  ]);
});

test("puts pageSetup after pageMargins but before the tail elements", () => {
  const sheet = ["sheetData", "mergeCells", "pageMargins", "legacyDrawing"];
  assert.deepEqual(insert(sheet, "pageSetup"), [
    "sheetData", "mergeCells", "pageMargins", "pageSetup", "legacyDrawing",
  ]);
});

test("keeps the three print settings in schema order when added one by one", () => {
  let sheet = ["sheetData", "mergeCells", "legacyDrawing"];
  for (const name of ["printOptions", "pageMargins", "pageSetup"]) sheet = insert(sheet, name);
  assert.deepEqual(sheet, [
    "sheetData", "mergeCells", "printOptions", "pageMargins", "pageSetup", "legacyDrawing",
  ]);
});

test("appends when nothing has to follow the new element", () => {
  const sheet = ["sheetData", "mergeCells"];
  assert.equal(worksheetSettingIndex(sheet, "pageSetup"), 2);
});

test("ignores elements it does not know instead of reordering around them", () => {
  const sheet = ["sheetData", "somethingUnknown", "pageMargins"];
  assert.deepEqual(insert(sheet, "printOptions"), [
    "sheetData", "somethingUnknown", "printOptions", "pageMargins",
  ]);
});
