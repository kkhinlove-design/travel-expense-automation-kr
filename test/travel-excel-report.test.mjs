import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import JSZip from "jszip";

import {
  buildTravelWorkbook,
  packReportLinesForSheet,
  reportContentRowHeight,
} from "../lib/travel-excel.js";
import { calculateTripExpense } from "../lib/travel-rules.js";

const XML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function cellText(sheet, address) {
  const cell = [...sheet.getElementsByTagNameNS(XML_NS, "c")].find((item) => item.getAttribute("r") === address);
  return cell?.getElementsByTagNameNS(XML_NS, "t")[0]?.textContent
    ?? cell?.getElementsByTagNameNS(XML_NS, "v")[0]?.textContent
    ?? "";
}

test("12줄을 넘는 복명 내용도 기존 12개 셀 안에 전부 보존한다", () => {
  const source = Array.from({ length: 31 }, (_, index) => `${index + 1}. 출장 수행 내용 ${"상세 ".repeat((index % 5) + 1)}`).join("\r\n");
  const normalized = source.replace(/\r\n?/g, "\n");
  const packed = packReportLinesForSheet(source);

  assert.equal(packed.length, 12);
  assert.equal(packed.join("\n"), normalized);
  assert.match(packed.at(-1), /31\. 출장 수행 내용/);
});

test("사용자가 넣은 빈 줄과 앞뒤 공백도 조용히 삭제하지 않는다", () => {
  const source = "  첫 줄  \n\n둘째 줄\n";
  const packed = packReportLinesForSheet(source, 2);
  assert.equal(packed.length, 2);
  assert.equal(packed.join("\n"), source);
});

test("여러 줄이나 긴 문장은 기본 높이보다 행을 늘리고 Excel 최대 높이를 넘지 않는다", () => {
  assert.equal(reportContentRowHeight("짧은 한 줄"), 24.75);
  assert.ok(reportContentRowHeight("첫 줄\n둘째 줄\n셋째 줄") > 24.75);
  assert.ok(reportContentRowHeight("긴 내용".repeat(2_000)) <= 409);
});

test("생성된 복명서가 전 내용을 담고 줄바꿈·행높이·A4 한쪽 맞춤을 설정한다", async () => {
  const templatePath = fileURLToPath(new URL("../public/templates/travel-template.xlsx", import.meta.url));
  const template = await readFile(templatePath);
  const reportContent = Array.from({ length: 25 }, (_, index) => `${index + 1}. 수행 결과와 후속 조치`).join("\n");
  const trip = {
    tripScope: "external",
    department: "기업성장실",
    position: "2급",
    employeeName: "고경환",
    purpose: "협력기관 업무 협의",
    destination: "남원 사업단",
    origin: "전주",
    transportDestination: "남원",
    startAt: "2026-08-03T09:00",
    endAt: "2026-08-03T18:00",
    transportType: "personal",
    projectType: "general",
    lodgingRegion: "other",
    outboundTransportActual: 6_900,
    returnTransportActual: 6_900,
    reportContent,
    participants: [{
      id: "primary",
      department: "기업성장실",
      position: "2급",
      employeeName: "고경환",
      transportClaimant: true,
      lodgingActual: 0,
      deduction: 0,
      mealsProvided: { breakfast: false, lunch: false, dinner: false },
    }],
  };
  const originalFetch = globalThis.fetch;
  const originalDomParser = globalThis.DOMParser;
  const originalXmlSerializer = globalThis.XMLSerializer;
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength),
  });
  globalThis.DOMParser = DOMParser;
  globalThis.XMLSerializer = XMLSerializer;

  try {
    const workbook = await buildTravelWorkbook(trip, calculateTripExpense(trip));
    const zip = await JSZip.loadAsync(await workbook.arrayBuffer());
    const sheetXml = await zip.file("xl/worksheets/sheet3.xml").async("string");
    const sheet = new DOMParser().parseFromString(sheetXml, "application/xml");
    const reportCells = [...sheet.getElementsByTagNameNS(XML_NS, "c")]
      .filter((cell) => /^B(?:1[2-9]|2[0-3])$/.test(cell.getAttribute("r")))
      .sort((left, right) => Number(left.getAttribute("r").slice(1)) - Number(right.getAttribute("r").slice(1)));
    const restored = reportCells.map((cell) => cell.getElementsByTagNameNS(XML_NS, "t")[0]?.textContent ?? "").join("\n");
    assert.equal(restored, reportContent);

    const reportRows = [...sheet.getElementsByTagNameNS(XML_NS, "row")]
      .filter((row) => Number(row.getAttribute("r")) >= 12 && Number(row.getAttribute("r")) <= 23);
    assert.equal(reportRows.length, 12);
    assert.ok(reportRows.some((row) => Number(row.getAttribute("ht")) > 24.75));

    const styleIndex = Number(reportCells[0].getAttribute("s"));
    const stylesXml = await zip.file("xl/styles.xml").async("string");
    const styles = new DOMParser().parseFromString(stylesXml, "application/xml");
    const cellStyles = [...styles.getElementsByTagNameNS(XML_NS, "cellXfs")[0].children]
      .filter((child) => child.localName === "xf");
    const alignment = [...cellStyles[styleIndex].children].find((child) => child.localName === "alignment");
    assert.equal(alignment?.getAttribute("wrapText"), "1");

    assert.equal(sheet.getElementsByTagNameNS(XML_NS, "pageSetUpPr")[0]?.getAttribute("fitToPage"), "1");
    const pageSetup = sheet.getElementsByTagNameNS(XML_NS, "pageSetup")[0];
    assert.equal(pageSetup?.getAttribute("paperSize"), "9");
    assert.equal(pageSetup?.getAttribute("orientation"), "portrait");
    assert.equal(pageSetup?.getAttribute("fitToWidth"), "1");
    assert.equal(pageSetup?.getAttribute("fitToHeight"), "1");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.DOMParser = originalDomParser;
    globalThis.XMLSerializer = originalXmlSerializer;
  }
});

test("신청서·지출명세서는 지역명만 쓰고 법인차 동승자를 구분한다", async () => {
  const templatePath = fileURLToPath(new URL("../public/templates/travel-template.xlsx", import.meta.url));
  const template = await readFile(templatePath);
  const trip = {
    tripScope: "domestic",
    purpose: "식품센터 실적보고 및 업무협의",
    destination: "전북 군산-식품일자리센터※실적보고 협의",
    origin: "전주시외버스터미널※승차",
    transportDestination: "군산시외버스터미널(하차장)",
    waypoints: ["익산역(환승)"],
    startAt: "2026-08-05T09:00",
    endAt: "2026-08-05T18:00",
    transportType: "corporate",
    projectType: "general",
    lodgingRegion: "other",
    outboundTransportActual: 0,
    returnTransportActual: 0,
    participants: [
      { id: "p1", department: "기획실", position: "실장", employeeName: "홍길동", purpose: "업무협의", transportClaimant: true, lodgingActual: 0, deduction: 0, mealsProvided: {} },
      { id: "p2", department: "기획실", position: "매니저", employeeName: "김철수", purpose: "업무협의", transportClaimant: false, lodgingActual: 0, deduction: 0, mealsProvided: {} },
    ],
  };
  const originalFetch = globalThis.fetch;
  const originalDomParser = globalThis.DOMParser;
  const originalXmlSerializer = globalThis.XMLSerializer;
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength),
  });
  globalThis.DOMParser = DOMParser;
  globalThis.XMLSerializer = XMLSerializer;

  try {
    const workbook = await buildTravelWorkbook(trip, calculateTripExpense(trip));
    const zip = await JSZip.loadAsync(await workbook.arrayBuffer());
    const application = new DOMParser().parseFromString(await zip.file("xl/worksheets/sheet1.xml").async("string"), "application/xml");
    const statement = new DOMParser().parseFromString(await zip.file("xl/worksheets/sheet2.xml").async("string"), "application/xml");
    assert.equal(cellText(application, "C6"), trip.destination);
    assert.equal(cellText(application, "G6"), "");
    assert.equal(cellText(application, "F10"), "전주");
    assert.equal(cellText(application, "I10"), "군산");
    assert.equal(cellText(application, "F11"), "군산");
    assert.equal(cellText(application, "I11"), "전주");
    assert.equal(cellText(statement, "D4"), "군산");
    assert.equal(cellText(statement, "D5"), "군산");
    assert.equal(cellText(statement, "E4"), "법인차");
    assert.equal(cellText(statement, "E5"), "법인차(동승)");
    assert.equal(cellText(statement, "B13"), "전주");
    assert.equal(cellText(statement, "C13"), "익산");
    assert.equal(cellText(statement, "D13"), "군산");
    assert.equal(cellText(statement, "B14"), "군산");
    assert.equal(cellText(statement, "C14"), "익산");
    assert.equal(cellText(statement, "D14"), "전주");
    const report = new DOMParser().parseFromString(await zip.file("xl/worksheets/sheet3.xml").async("string"), "application/xml");
    assert.equal(cellText(report, "B8"), trip.destination);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.DOMParser = originalDomParser;
    globalThis.XMLSerializer = originalXmlSerializer;
  }
});
