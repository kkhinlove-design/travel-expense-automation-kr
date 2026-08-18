import assert from "node:assert/strict";
import test from "node:test";

import { parseApprovedTravelHwpxTables, parseApprovedTravelPdfItems } from "../lib/travel-parser.js";

test("PDF 표의 같은 행에서 목적·출장지 셀을 좌표로 분리한다", () => {
  const item = (str, x, y, width) => ({ str, x, y, width });
  const department = "가상식품산업일자리센터";
  const items = [
    item("부서", 78.75, 530.75, 21.75),
    item("직위/책", 141, 530.75, 38.25),
    item("성", 196.5, 530.75, 11.25),
    item("명", 218.25, 530.75, 11.25),
    item("출장목적(구체적)", 258.75, 530.75, 81.75),
    item("출장기간", 380.25, 530.75, 44.25),
    item("출장지", 456.75, 539.75, 33),
    item("(방문기관)", 447, 522.5, 52),
    item("비", 510.75, 530.75, 11.25),
    item("고", 532.5, 530.75, 11.25),
    ...Array.from(department).map((character, index) => item(character, 47.25 + index * 7.5, 485.75, 9.75)),
    item("4", 152.25, 485.75, 5.68),
    item("급", 158.25, 485.75, 9.75),
    item("홍길동", 198, 485.75, 29.99),
    item("식품일자리센터", 243.75, 494, 69.75),
    item("실적보고", 318.75, 494, 39.75),
    item("및", 273.75, 477.5, 9.75),
    item("업무협의", 288.75, 477.5, 39.75),
    item("2026.08.05", 375, 506, 53.68),
    item("09:00", 388.5, 495.5, 26.68),
    item("~", 398.25, 485.75, 7.7),
    item("2026.08.05", 375, 476, 53.68),
    item("18:00", 388.5, 465.5, 26.68),
    item("전북", 450.75, 501.5, 19.5),
    item("군산", 475.5, 501.5, 20.25),
    item("(", 446.25, 485.75, 3.66),
    item("가상산학융", 450, 485.75, 49.5),
    item("합원", 461.25, 470, 19.5),
    item(")", 481.5, 470, 3.66),
    item("법인차량", 507.75, 485.75, 38.25),
    item("붙임", 103.5, 160.25, 22.5),
  ];

  const parsed = parseApprovedTravelPdfItems(items, "비식별화된 PDF 표");

  assert.equal(parsed.department, department);
  assert.equal(parsed.position, "4급");
  assert.equal(parsed.employeeName, "홍길동");
  assert.equal(parsed.purpose, "식품일자리센터 실적보고 및 업무협의");
  assert.equal(parsed.destination, "전북 군산(가상산학융합원)");
  assert.equal(parsed.startAt, "2026-08-05T09:00");
  assert.equal(parsed.endAt, "2026-08-05T18:00");
  assert.equal(parsed.transportType, "corporate");
  assert.deepEqual(parsed.missing, []);
});

test("maps a structured HWPX travel table without guessing from joined text", () => {
  const tables = [
    [
      ["문서번호", "기관-001"],
      ["문서제목", "출장신청_260811_김하나, 이두리"],
    ],
    [
      ["부서", "직위/직책", "성 명", "출장목적(구체적)", "출장기간", "출장지\n(방문기관)", "비 고"],
      ["사업팀", "3급", "김하나", "업무협의", "2026.08.11 09:00 ~ 2026.08.11 18:00", "전북특별자치도 전주", ""],
      ["사업팀", "4급", "이두리", "업무협의", "2026.08.11 09:00 ~ 2026.08.11 18:00", "전북특별자치도 전주", ""],
      ["붙임", "관련 공문"],
    ],
  ];

  const parsed = parseApprovedTravelHwpxTables(tables, "비식별화된 테스트 문서");

  assert.equal(parsed.documentNumber, "기관-001");
  assert.equal(parsed.employeeName, "김하나");
  assert.equal(parsed.purpose, "업무협의");
  assert.equal(parsed.destination, "전북특별자치도 전주");
  assert.equal(parsed.startAt, "2026-08-11T09:00");
  assert.equal(parsed.endAt, "2026-08-11T18:00");
  assert.equal(parsed.transportType, "");
  assert.deepEqual(parsed.participants.map((participant) => participant.employeeName), ["김하나", "이두리"]);
  assert.equal(parsed.participants.filter((participant) => participant.transportClaimant).length, 1);
  assert.deepEqual(parsed.missing, []);
});
