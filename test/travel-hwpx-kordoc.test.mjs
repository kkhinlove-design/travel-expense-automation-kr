import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import { markdownToHwpx } from "kordoc";

import {
  MAX_KORDOC_HWPX_EXPANDED_SIZE,
  MAX_KORDOC_HWPX_FILE_SIZE,
  TravelHwpxKordocError,
  kordocTravelTables,
  parseApprovedTravelHwpxWithKordoc,
} from "../lib/travel-hwpx-kordoc.server.js";
import {
  extractApprovedTravelHwpx,
  extractApprovedTravelHwpxLocal,
  mergeApprovedTravelHwpxResults,
} from "../lib/travel-parser.js";

const TRAVEL_MARKDOWN = `
| 부서 | 직위/직책 | 성명 | 출장목적(구체적) | 출장기간 | 출장지(방문기관) | 비고 |
|---|---|---|---|---|---|---|
| 합성팀 | 3급 | 직원가 | 현장 협의 | 2026.08.18 09:00 ~ 2026.08.18 18:00 | 전북 합성센터 | 개인차 |
| 합성팀 | 4급 | 직원나 | 현장 협의 | 2026.08.18 09:00 ~ 2026.08.18 18:00 | 전북 합성센터 | 개인차 |
`;

test("Kordoc server parser maps a synthetic HWPX travel table", async () => {
  const hwpx = await markdownToHwpx(TRAVEL_MARKDOWN);
  const parsed = await parseApprovedTravelHwpxWithKordoc(hwpx);

  assert.equal(parsed.employeeName, "직원가");
  assert.equal(parsed.purpose, "현장 협의");
  assert.equal(parsed.destination, "전북 합성센터");
  assert.equal(parsed.startAt, "2026-08-18T09:00");
  assert.equal(parsed.endAt, "2026-08-18T18:00");
  assert.equal(parsed.transportType, "personal");
  assert.deepEqual(parsed.participants.map((participant) => participant.employeeName), ["직원가", "직원나"]);
  assert.deepEqual(parsed.missing, []);
});

test("Kordoc server parser rejects a synthetic non-travel HWPX", async () => {
  const hwpx = await markdownToHwpx(`
| 구분 | 내용 |
|---|---|
| 적용대상 | 합성 지침 |
| 참고사항 | 출장신청서가 아닌 문서 |
`);

  await assert.rejects(
    () => parseApprovedTravelHwpxWithKordoc(hwpx),
    (error) => error instanceof TravelHwpxKordocError && error.code === "TRAVEL_TABLE_NOT_FOUND",
  );
});

test("Kordoc table adapter walks nested cell blocks", () => {
  const nestedTravelTable = {
    type: "table",
    table: {
      cells: [
        [
          { text: "부서" },
          { text: "성명" },
          { text: "출장목적" },
          { text: "출장기간" },
          { text: "출장지(방문기관)" },
        ],
        [
          { text: "합성팀" },
          { text: "직원가" },
          { text: "현장 협의" },
          { text: "2026.08.18 09:00 ~ 2026.08.18 18:00" },
          { text: "전북 합성센터" },
        ],
      ],
    },
  };
  const outerTable = {
    type: "table",
    table: {
      cells: [[{ text: "바깥 셀", blocks: [nestedTravelTable] }]],
    },
  };

  assert.deepEqual(kordocTravelTables([outerTable]), [
    [["바깥 셀"]],
    [
      ["부서", "성명", "출장목적", "출장기간", "출장지(방문기관)"],
      ["합성팀", "직원가", "현장 협의", "2026.08.18 09:00 ~ 2026.08.18 18:00", "전북 합성센터"],
    ],
  ]);
});

test("Kordoc result overrides an ambiguous text fallback without losing local metadata", () => {
  const local = {
    documentNumber: "합성-001",
    documentTitle: "합성 출장신청",
    department: "합성팀",
    position: "3급",
    employeeName: "직원가",
    participants: [],
    purpose: "잘못 추정된 목적",
    destination: "잘못 추정된 장소",
    startAt: "",
    endAt: "",
    transportType: "",
    parsedText: "로컬 텍스트",
    waypoints: [],
  };
  const kordoc = {
    documentNumber: "",
    documentTitle: "",
    department: "합성팀",
    position: "3급",
    employeeName: "직원가",
    participants: [{ id: "participant-1", employeeName: "직원가", transportClaimant: true }],
    reporterParticipantId: "participant-1",
    purpose: "현장 협의",
    destination: "전북 합성센터",
    startAt: "2026-08-18T09:00",
    endAt: "2026-08-18T18:00",
    transportType: "personal",
    parsedText: "Kordoc 구조 텍스트",
    waypoints: [],
  };

  const merged = mergeApprovedTravelHwpxResults(local, kordoc);
  assert.equal(merged.documentNumber, "합성-001");
  assert.equal(merged.purpose, "현장 협의");
  assert.equal(merged.destination, "전북 합성센터");
  assert.equal(merged.participants.length, 1);
  assert.deepEqual(merged.missing, []);
});

test("authenticated browser requests Kordoc even when local structured parsing is complete", async () => {
  const hwpx = await markdownToHwpx(TRAVEL_MARKDOWN);
  const file = new Blob([hwpx], { type: "application/octet-stream" });
  Object.defineProperty(file, "name", { value: "synthetic-travel.hwpx" });

  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const previousDomParser = globalThis.DOMParser;
  globalThis.window = {};
  globalThis.DOMParser = DOMParser;

  try {
    const local = await extractApprovedTravelHwpxLocal(file);
    assert.deepEqual(local.missing, []);

    let serverCallCount = 0;
    globalThis.fetch = async (url, options) => {
      serverCallCount += 1;
      assert.equal(url, "/api/travel/parse-hwpx");
      assert.equal(options.method, "POST");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          parsed: {
            ...local,
            purpose: "Kordoc 확인 목적",
            destination: "Kordoc 확인 장소",
          },
        }),
      };
    };

    const parsed = await extractApprovedTravelHwpx(file);
    assert.equal(serverCallCount, 1);
    assert.equal(parsed.purpose, "Kordoc 확인 목적");
    assert.equal(parsed.destination, "Kordoc 확인 장소");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousDomParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = previousDomParser;
  }
});

test("browser structured result remains available when Kordoc API fails", async () => {
  const hwpx = await markdownToHwpx(TRAVEL_MARKDOWN);
  const file = new Blob([hwpx], { type: "application/octet-stream" });
  Object.defineProperty(file, "name", { value: "synthetic-fallback.hwpx" });

  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const previousDomParser = globalThis.DOMParser;
  globalThis.window = {};
  globalThis.DOMParser = DOMParser;

  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "합성 서버 오류", code: "HWPX_SERVER_PARSE_FAILED" }),
    });

    const parsed = await extractApprovedTravelHwpx(file);
    assert.equal(parsed.purpose, "현장 협의");
    assert.equal(parsed.destination, "전북 합성센터");
    assert.deepEqual(parsed.missing, []);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousDomParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = previousDomParser;
  }
});

test("Kordoc parser enforces the HWPX upload size limit before parsing", async () => {
  const oversized = new Uint8Array(MAX_KORDOC_HWPX_FILE_SIZE + 1);
  await assert.rejects(
    () => parseApprovedTravelHwpxWithKordoc(oversized),
    (error) => error instanceof TravelHwpxKordocError && error.code === "HWPX_FILE_TOO_LARGE",
  );
});

test("Kordoc parser rejects a highly compressed HWPX before expanding it", async () => {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip");
  zip.file("Contents/section0.xml", new Uint8Array(MAX_KORDOC_HWPX_EXPANDED_SIZE + 1).fill(65));
  const compressed = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  assert.ok(compressed.length < MAX_KORDOC_HWPX_FILE_SIZE);
  await assert.rejects(
    () => parseApprovedTravelHwpxWithKordoc(compressed),
    (error) => error instanceof TravelHwpxKordocError && error.code === "HWPX_EXPANDED_SIZE_TOO_LARGE",
  );
});

test("browser travel parser does not import Kordoc", async () => {
  const source = await readFile(new URL("../lib/travel-parser.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:from\s+|import\s*\()\s*["']kordoc["']/);
});
