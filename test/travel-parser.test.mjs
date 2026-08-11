import assert from "node:assert/strict";
import test from "node:test";

import { parseApprovedTravelHwpxTables } from "../lib/travel-parser.js";

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
