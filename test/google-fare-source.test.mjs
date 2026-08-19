import test from "node:test";
import assert from "node:assert/strict";
import { parseCsvMatrix, parseGoogleFareSourceCsv } from "../lib/google-fare-source.js";

const header = "출발 시·군,도착지,노선구분,버스등급,요금,첫차/운행정보,수집처,수집일시";

test("Google 운임 시트는 같은 노선에서 우등을 우선하고 대체 등급 수를 알린다", () => {
  const parsed = parseGoogleFareSourceCsv([
    header,
    '전주시,서울(센트럴시티),고속버스,프리미엄,"24,300원",운행,공식,2026-08-19',
    '전주시,서울(센트럴시티),고속버스,우등,"18,700원",운행,공식,2026-08-19',
    '전주시,남원시,시외버스,일반,"6,900원",운행,공식,2026-08-19',
  ].join("\n"));

  assert.equal(parsed.sourceRowCount, 3);
  assert.equal(parsed.routeCount, 2);
  assert.equal(parsed.alternativeCount, 1);
  const seoul = parsed.rows.find((row) => row.destination === "서울(센트럴시티)");
  assert.equal(seoul.outboundFare, 18_700);
  assert.equal(seoul.returnFare, 18_700);
  assert.equal(seoul.sourceGrade, "우등");
  assert.equal(seoul.reverseFareSource, "reverse-fallback");
});

test("정방향과 역방향 행이 모두 있으면 오는 길은 정확한 역방향 금액을 쓴다", () => {
  const parsed = parseGoogleFareSourceCsv([
    header,
    "전주시,남원시,시외버스,우등,6900,운행,공식,2026-08-19",
    "남원시,전주시,시외버스,우등,7200,운행,공식,2026-08-19",
  ].join("\n"));

  const outbound = parsed.rows.find((row) => row.origin === "전주시");
  const inbound = parsed.rows.find((row) => row.origin === "남원시");
  assert.deepEqual([outbound.outboundFare, outbound.returnFare], [6_900, 7_200]);
  assert.deepEqual([inbound.outboundFare, inbound.returnFare], [7_200, 6_900]);
  assert.equal(parsed.reversePairCount, 2);
});

test("같은 우선 등급에 서로 다른 요금이 있으면 임의로 고르지 않는다", () => {
  assert.throws(() => parseGoogleFareSourceCsv([
    header,
    "전주시,군산시,시외버스,우등,7000,운행,공식,2026-08-19",
    "전주시,군산시,시외버스,우등,8000,운행,공식,2026-08-19",
  ].join("\n")), /같은 우선 등급의 요금이 여러 개/);
});

test("CSV의 따옴표·쉼표·줄바꿈을 보존한다", () => {
  const rows = parseCsvMatrix('A,B\n"서울, 센트럴","첫차\n막차"');
  assert.deepEqual(rows, [["A", "B"], ["서울, 센트럴", "첫차\n막차"]]);
});
