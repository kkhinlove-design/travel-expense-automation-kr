import JSZip from "jszip";
import { buildRuleBasedTravelReport } from "./local-report-ai.js";
import { fareGradeForDocument, normalizeTripWaypoints, tripRoutePoints, tripTransportFares } from "./travel-rules.js";

const XML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPE_NS = "http://schemas.openxmlformats.org/package/2006/content-types";

function xml(text) {
  return new DOMParser().parseFromString(String(text).replace(/^\uFEFF/, ""), "application/xml");
}

function node(document, name) {
  return document.createElementNS(XML_NS, name);
}

function excelSerial(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function weekday(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return `(${["일", "월", "화", "수", "목", "금", "토"][date.getDay()]})`;
}

function dateLabel(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}월 ${String(date.getDate()).padStart(2, "0")}일`;
}

function timeLabel(value) {
  return String(value ?? "").slice(11, 16);
}

function cellRow(address) {
  return Number(address.match(/\d+/)?.[0] ?? 1);
}

function columnNumber(address) {
  return [...(address.match(/[A-Z]+/)?.[0] ?? "A")].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
}

function findOrCreateRow(document, sheetData, rowNumber) {
  const rows = [...sheetData.getElementsByTagNameNS(XML_NS, "row")];
  const current = rows.find((item) => Number(item.getAttribute("r")) === rowNumber);
  if (current) return current;
  const row = node(document, "row");
  row.setAttribute("r", String(rowNumber));
  const next = rows.find((item) => Number(item.getAttribute("r")) > rowNumber);
  sheetData.insertBefore(row, next ?? null);
  return row;
}

function findOrCreateCell(document, row, address) {
  const cells = [...row.getElementsByTagNameNS(XML_NS, "c")];
  const current = cells.find((item) => item.getAttribute("r") === address);
  if (current) return current;
  const cell = node(document, "c");
  cell.setAttribute("r", address);
  const targetColumn = columnNumber(address);
  const next = cells.find((item) => columnNumber(item.getAttribute("r")) > targetColumn);
  row.insertBefore(cell, next ?? null);
  return cell;
}

function setCell(document, sheetData, address, value) {
  const row = findOrCreateRow(document, sheetData, cellRow(address));
  const cell = findOrCreateCell(document, row, address);
  [...cell.children].forEach((child) => cell.removeChild(child));
  if (value === null || value === undefined || value === "") {
    cell.removeAttribute("t");
    return;
  }
  if (typeof value === "number") {
    // NaN이나 Infinity를 그대로 쓰면 셀이 깨진 채로 제출 서류가 만들어진다.
    // 잘못된 금액을 조용히 내려보내느니 내려받기를 실패시킨다.
    if (!Number.isFinite(value)) {
      throw new Error(`${address} 칸에 넣을 금액을 숫자로 확정하지 못했습니다. 입력한 금액을 확인한 뒤 다시 내려받아 주세요.`);
    }
    cell.removeAttribute("t");
    const valueNode = node(document, "v");
    valueNode.textContent = String(value);
    cell.appendChild(valueNode);
    return;
  }
  cell.setAttribute("t", "inlineStr");
  const inline = node(document, "is");
  const text = node(document, "t");
  text.setAttribute("xml:space", "preserve");
  text.textContent = String(value);
  inline.appendChild(text);
  cell.appendChild(inline);
}

async function sheetPath(zip, sheetName) {
  const workbookDoc = xml(await zip.file("xl/workbook.xml").async("string"));
  const sheet = [...workbookDoc.getElementsByTagNameNS(XML_NS, "sheet")].find((item) => item.getAttribute("name") === sheetName);
  if (!sheet) throw new Error(`${sheetName} 시트를 찾지 못했습니다.`);
  const relationshipId = sheet.getAttributeNS(REL_NS, "id") || sheet.getAttribute("r:id");
  const relsDoc = xml(await zip.file("xl/_rels/workbook.xml.rels").async("string"));
  const relationship = [...relsDoc.getElementsByTagName("Relationship")].find((item) => item.getAttribute("Id") === relationshipId);
  if (!relationship) throw new Error(`${sheetName} 시트 연결을 찾지 못했습니다.`);
  const target = relationship.getAttribute("Target").replace(/^\//, "");
  return target.startsWith("xl/") ? target : `xl/${target}`;
}

function safeSheetName(value, usedNames = new Set()) {
  const base = String(value || "Sheet")
    .replace(/[\\/?*\[\]:]/g, "_")
    .slice(0, 31) || "Sheet";
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    const tail = `_${suffix}`;
    candidate = `${base.slice(0, 31 - tail.length)}${tail}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

async function worksheetNames(zip) {
  const workbookDoc = xml(await zip.file("xl/workbook.xml").async("string"));
  return new Set([...workbookDoc.getElementsByTagNameNS(XML_NS, "sheet")].map((sheet) => sheet.getAttribute("name")));
}

async function duplicateWorksheet(zip, sourceSheetName, requestedName) {
  const workbookDoc = xml(await zip.file("xl/workbook.xml").async("string"));
  const sheetsNode = workbookDoc.getElementsByTagNameNS(XML_NS, "sheets")[0];
  const sheets = [...workbookDoc.getElementsByTagNameNS(XML_NS, "sheet")];
  const sourceSheet = sheets.find((sheet) => sheet.getAttribute("name") === sourceSheetName);
  if (!sourceSheet) throw new Error(`${sourceSheetName} 시트를 복제하지 못했습니다.`);

  const relsDoc = xml(await zip.file("xl/_rels/workbook.xml.rels").async("string"));
  const rels = [...relsDoc.getElementsByTagName("Relationship")];
  const sourceRelId = sourceSheet.getAttributeNS(REL_NS, "id") || sourceSheet.getAttribute("r:id");
  const sourceRel = rels.find((relationship) => relationship.getAttribute("Id") === sourceRelId);
  if (!sourceRel) throw new Error(`${sourceSheetName} 시트 연결을 복제하지 못했습니다.`);

  const usedIndexes = Object.keys(zip.files)
    .map((path) => path.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)?.[1])
    .filter(Boolean)
    .map(Number);
  const worksheetIndex = Math.max(0, ...usedIndexes) + 1;
  const worksheetTarget = `/xl/worksheets/sheet${worksheetIndex}.xml`;
  const worksheetPath = worksheetTarget.slice(1);
  const relationId = `RtravelWorksheet${worksheetIndex}`;
  const sheetId = Math.max(0, ...sheets.map((sheet) => Number(sheet.getAttribute("sheetId")) || 0)) + 1;

  const sourcePath = sourceRel.getAttribute("Target").replace(/^\//, "");
  const sourceDoc = xml(await zip.file(sourcePath).async("string"));
  [...sourceDoc.getElementsByTagNameNS(XML_NS, "legacyDrawing")].forEach((element) => element.parentNode.removeChild(element));
  zip.file(worksheetPath, new XMLSerializer().serializeToString(sourceDoc));

  const relation = relsDoc.createElementNS(PACKAGE_REL_NS, "Relationship");
  relation.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet");
  relation.setAttribute("Target", worksheetTarget);
  relation.setAttribute("Id", relationId);
  relsDoc.documentElement.appendChild(relation);

  const sheet = workbookDoc.createElementNS(XML_NS, "sheet");
  sheet.setAttribute("name", requestedName);
  sheet.setAttribute("sheetId", String(sheetId));
  sheet.setAttributeNS(REL_NS, "r:id", relationId);
  sheetsNode.appendChild(sheet);

  const contentTypesDoc = xml(await zip.file("[Content_Types].xml").async("string"));
  const override = contentTypesDoc.createElementNS(CONTENT_TYPE_NS, "Override");
  override.setAttribute("PartName", worksheetTarget);
  override.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
  contentTypesDoc.documentElement.appendChild(override);

  zip.file("xl/workbook.xml", new XMLSerializer().serializeToString(workbookDoc));
  zip.file("xl/_rels/workbook.xml.rels", new XMLSerializer().serializeToString(relsDoc));
  zip.file("[Content_Types].xml", new XMLSerializer().serializeToString(contentTypesDoc));
  return requestedName;
}

async function renameWorksheet(zip, currentName, nextName) {
  if (currentName === nextName) return nextName;
  const workbookDoc = xml(await zip.file("xl/workbook.xml").async("string"));
  const sheet = [...workbookDoc.getElementsByTagNameNS(XML_NS, "sheet")].find((item) => item.getAttribute("name") === currentName);
  if (!sheet) throw new Error(`${currentName} 시트 이름을 바꾸지 못했습니다.`);
  sheet.setAttribute("name", nextName);
  zip.file("xl/workbook.xml", new XMLSerializer().serializeToString(workbookDoc));
  return nextName;
}

async function orderWorksheets(zip, orderedNames) {
  const workbookDoc = xml(await zip.file("xl/workbook.xml").async("string"));
  const sheetsNode = workbookDoc.getElementsByTagNameNS(XML_NS, "sheets")[0];
  const byName = new Map([...workbookDoc.getElementsByTagNameNS(XML_NS, "sheet")].map((sheet) => [sheet.getAttribute("name"), sheet]));
  orderedNames.forEach((name) => {
    const sheet = byName.get(name);
    if (sheet) sheetsNode.appendChild(sheet);
  });
  zip.file("xl/workbook.xml", new XMLSerializer().serializeToString(workbookDoc));
}

async function patchSheet(zip, sheetName, patches) {
  const path = await sheetPath(zip, sheetName);
  const document = xml(await zip.file(path).async("string"));
  const sheetData = document.getElementsByTagNameNS(XML_NS, "sheetData")[0];
  Object.entries(patches).forEach(([address, value]) => setCell(document, sheetData, address, value));
  zip.file(path, new XMLSerializer().serializeToString(document));
}

async function setSheetRowHeight(zip, sheetName, rowNumber, height) {
  const path = await sheetPath(zip, sheetName);
  const document = xml(await zip.file(path).async("string"));
  const sheetData = document.getElementsByTagNameNS(XML_NS, "sheetData")[0];
  const row = findOrCreateRow(document, sheetData, rowNumber);
  row.setAttribute("ht", String(height));
  row.setAttribute("customHeight", "1");
  zip.file(path, new XMLSerializer().serializeToString(document));
}

// ECMA-376 CT_Worksheet가 요구하는 자식 요소 순서. Excel은 이 순서를 어기면
// 파일을 손상으로 보고 복구하면서 해당 시트 내용을 버린다.
const WORKSHEET_CHILD_ORDER = [
  "sheetPr",
  "dimension",
  "sheetViews",
  "sheetFormatPr",
  "cols",
  "sheetData",
  "sheetCalcPr",
  "sheetProtection",
  "protectedRanges",
  "scenarios",
  "autoFilter",
  "sortState",
  "dataConsolidate",
  "customSheetViews",
  "mergeCells",
  "phoneticPr",
  "conditionalFormatting",
  "dataValidations",
  "hyperlinks",
  "printOptions",
  "pageMargins",
  "pageSetup",
  "headerFooter",
  "rowBreaks",
  "colBreaks",
  "customProperties",
  "cellWatches",
  "ignoredErrors",
  "smartTags",
  "drawing",
  "drawingHF",
  "legacyDrawing",
  "legacyDrawingHF",
  "picture",
  "oleObjects",
  "controls",
  "webPublishItems",
  "tableParts",
  "extLst",
];

/**
 * 새 설정 요소가 들어갈 자리를 이름만으로 정한다.
 * DOM 없이도 검증할 수 있도록 위치 계산만 떼어 두었다.
 * 반환값은 기존 자식 목록에서 이 요소보다 뒤에 와야 하는 첫 요소의 인덱스이며,
 * 그런 요소가 없으면 목록 끝을 가리킨다.
 */
export function worksheetSettingIndex(existingNames, name) {
  const order = WORKSHEET_CHILD_ORDER.indexOf(name);
  if (order < 0) return existingNames.length;
  const index = existingNames.findIndex((child) => {
    const childOrder = WORKSHEET_CHILD_ORDER.indexOf(child);
    return childOrder >= 0 && childOrder > order;
  });
  return index < 0 ? existingNames.length : index;
}

function insertWorksheetSetting(document, element) {
  const children = [...document.documentElement.children];
  const index = worksheetSettingIndex(children.map((child) => child.localName), element.localName);
  document.documentElement.insertBefore(element, children[index] ?? null);
}

async function setSheetPrintLayout(zip, sheetName, { orientation, margins, centered = false, fitOnePage = false }) {
  const path = await sheetPath(zip, sheetName);
  const document = xml(await zip.file(path).async("string"));

  let printOptions = document.getElementsByTagNameNS(XML_NS, "printOptions")[0];
  if (centered) {
    if (!printOptions) {
      printOptions = node(document, "printOptions");
      insertWorksheetSetting(document, printOptions);
    }
    printOptions.setAttribute("horizontalCentered", "1");
    printOptions.setAttribute("verticalCentered", "1");
  }

  let pageMargins = document.getElementsByTagNameNS(XML_NS, "pageMargins")[0];
  if (!pageMargins) {
    pageMargins = node(document, "pageMargins");
    insertWorksheetSetting(document, pageMargins);
  }
  Object.entries(margins).forEach(([name, value]) => pageMargins.setAttribute(name, String(value)));

  let pageSetup = document.getElementsByTagNameNS(XML_NS, "pageSetup")[0];
  if (!pageSetup) {
    pageSetup = node(document, "pageSetup");
    insertWorksheetSetting(document, pageSetup);
  }
  pageSetup.setAttribute("paperSize", "9");
  pageSetup.setAttribute("orientation", orientation);
  if (fitOnePage) {
    pageSetup.setAttribute("fitToWidth", "1");
    pageSetup.setAttribute("fitToHeight", "1");
    pageSetup.removeAttribute("scale");
  }

  zip.file(path, new XMLSerializer().serializeToString(document));
}

function reportLines(trip) {
  const entered = String(trip.reportContent ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const defaults = buildRuleBasedTravelReport(trip).split(/\r?\n/);
  return entered.length ? entered.slice(0, 12) : defaults;
}

export async function buildTravelWorkbook(trip, expense) {
  const response = await fetch("/templates/travel-template.xlsx");
  if (!response.ok) throw new Error("Excel 양식 파일을 불러오지 못했습니다.");
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const startDate = String(trip.startAt).slice(0, 10);
  const endDate = String(trip.endAt).slice(0, 10);
  const requestDate = new Date().toISOString().slice(0, 10);
  const transportLabel = trip.transportType === "corporate" ? "법인차" : trip.transportType === "personal" ? "개인차" : "대중교통";
  const visitDestination = trip.destination || "";
  const statementDestination = visitDestination.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  const outboundRoute = tripRoutePoints(trip);
  const returnRoute = tripRoutePoints(trip, "return");
  const origin = outboundRoute[0] || trip.origin || "출발지";
  const transportDestination = outboundRoute.at(-1) || statementDestination || "-";
  const returnDeparture = returnRoute[0] || transportDestination;
  const waypoints = normalizeTripWaypoints(trip);
  const outboundWaypoints = waypoints.join(" → ") || "-";
  const returnWaypoints = [...waypoints].reverse().join(" → ") || "-";
  const outboundWaypointCell = waypoints.join("\n") || "-";
  const returnWaypointCell = [...waypoints].reverse().join("\n") || "-";
  const outboundArrival = outboundRoute.at(-1) || "-";
  const returnArrival = returnRoute.at(-1) || "-";
  const transportFares = tripTransportFares(trip);
  const hasDirectionalSources = Boolean(trip.fareSources?.outbound || trip.fareSources?.return);
  const outboundGrade = fareGradeForDocument(trip.fareSources?.outbound?.grade || (!hasDirectionalSources ? trip.fareSource?.grade : null));
  const returnGrade = fareGradeForDocument(trip.fareSources?.return?.grade || (!hasDirectionalSources ? trip.fareSource?.grade : null));
  const participantExpenses = expense.participantExpenses?.length
    ? expense.participantExpenses
    : [{
        participant: {
          id: "primary",
          department: trip.department,
          position: trip.position,
          employeeName: trip.employeeName,
          transportClaimant: true,
          lodgingActual: trip.lodgingActual,
          deduction: trip.deduction,
          mealsProvided: trip.mealsProvided ?? {},
        },
        ...expense,
      }];

  const usedNames = await worksheetNames(zip);
  const applicationNames = [];
  if (participantExpenses.length === 1) {
    applicationNames.push("여비지급신청서");
  } else {
    for (let index = 1; index < participantExpenses.length; index += 1) {
      const participant = participantExpenses[index].participant;
      const name = safeSheetName(`여비신청_${index + 1}_${participant.employeeName || "출장자"}`, usedNames);
      applicationNames.push(await duplicateWorksheet(zip, "여비지급신청서", name));
    }
    const firstParticipant = participantExpenses[0].participant;
    const firstName = safeSheetName(`여비신청_1_${firstParticipant.employeeName || "출장자"}`, usedNames);
    await renameWorksheet(zip, "여비지급신청서", firstName);
    applicationNames.unshift(firstName);
  }

  for (let index = 0; index < participantExpenses.length; index += 1) {
    const item = participantExpenses[index];
    const participant = item.participant;
    const provided = participant.mealsProvided ?? {};
    const participantFares = participant.transportClaimant ? transportFares : { outbound: 0, return: 0, total: 0 };
    await patchSheet(zip, applicationNames[index], {
      B4: participant.department,
      G4: participant.position,
      M4: participant.employeeName,
      C5: excelSerial(startDate),
      K5: weekday(startDate),
      L5: `${item.days}일간`,
      C6: waypoints.length ? `${statementDestination} · 경유 ${outboundWaypoints}` : visitDestination,
      G6: participant.purpose || trip.purpose,
      C7: item.lodging,
      C8: provided.breakfast ? "○" : "×",
      I8: provided.lunch ? "○" : "×",
      O8: provided.dinner ? "○" : "×",
      B10: excelSerial(startDate),
      C10: transportLabel,
      F10: origin,
      I10: outboundArrival,
      L10: participant.transportClaimant ? outboundGrade : "동승",
      O10: participantFares.outbound,
      B11: excelSerial(endDate),
      C11: transportLabel,
      F11: returnDeparture,
      I11: returnArrival,
      L11: participant.transportClaimant ? returnGrade : "동승",
      O11: participantFares.return,
      O12: null,
      O13: null,
      O14: item.transport,
      A19: excelSerial(requestDate),
      L20: participant.employeeName,
    });
    if (waypoints.length) await setSheetRowHeight(zip, applicationNames[index], 6, 42);
  }

  const expenseGroups = [];
  for (let index = 0; index < participantExpenses.length; index += 5) expenseGroups.push(participantExpenses.slice(index, index + 5));
  const expenseNames = [];
  if (expenseGroups.length === 1) {
    expenseNames.push("여비지출명세서");
  } else {
    for (let index = 1; index < expenseGroups.length; index += 1) {
      const name = safeSheetName(`여비지출명세서_${index + 1}`, usedNames);
      expenseNames.push(await duplicateWorksheet(zip, "여비지출명세서", name));
    }
    const firstName = safeSheetName("여비지출명세서_1", usedNames);
    await renameWorksheet(zip, "여비지출명세서", firstName);
    expenseNames.unshift(firstName);
  }

  for (let groupIndex = 0; groupIndex < expenseGroups.length; groupIndex += 1) {
    const group = expenseGroups[groupIndex];
    const groupTotal = group.reduce((total, item) => ({
      transport: total.transport + item.transport,
      perDiem: total.perDiem + item.perDiem,
      lodging: total.lodging + item.lodging,
      meal: total.meal + item.meal,
      deduction: total.deduction + item.deduction,
      total: total.total + item.total,
    }), { transport: 0, perDiem: 0, lodging: 0, meal: 0, deduction: 0, total: 0 });
    const groupPatches = {};
    for (let row = 4; row <= 8; row += 1) {
      ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "M", "O"].forEach((column) => { groupPatches[`${column}${row}`] = null; });
      const item = group[row - 4];
      if (!item) continue;
      const participant = item.participant;
      Object.assign(groupPatches, {
        [`A${row}`]: participant.department,
        [`B${row}`]: participant.position,
        [`C${row}`]: participant.employeeName,
        [`D${row}`]: statementDestination,
        [`E${row}`]: transportLabel,
        [`F${row}`]: item.days,
        [`G${row}`]: item.nights,
        [`H${row}`]: item.transport,
        [`I${row}`]: item.perDiem,
        [`J${row}`]: item.lodging,
        [`K${row}`]: item.meal,
        [`M${row}`]: item.deduction,
        [`O${row}`]: item.total,
      });
    }

    const lodgingUnit = expense.nights && group.length ? Math.round(groupTotal.lodging / (expense.nights * group.length)) : 0;
    const mealUnit = expense.days && group.length ? Math.round(groupTotal.meal / (expense.days * group.length)) : 0;
    const groupFares = groupTotal.transport ? transportFares : { outbound: 0, return: 0, total: 0 };
    Object.assign(groupPatches, {
      H9: groupTotal.transport,
      I9: groupTotal.perDiem,
      J9: groupTotal.lodging,
      K9: groupTotal.meal,
      M9: groupTotal.deduction,
      O9: groupTotal.total,
      A13: excelSerial(startDate),
      B13: origin,
      C13: outboundWaypointCell,
      D13: outboundArrival,
      E13: groupFares.outbound,
      F13: expense.days,
      G13: expense.nights,
      H13: "운임",
      I13: transportLabel,
      J13: groupFares.outbound,
      K13: groupTotal.transport,
      M13: 0,
      O13: groupTotal.transport,
      A14: excelSerial(endDate),
      B14: returnDeparture,
      C14: returnWaypointCell,
      D14: returnArrival,
      E14: groupFares.return,
      F14: expense.days,
      G14: expense.nights,
      H14: "일비",
      I14: `${group.length}명 × ${expense.days}일`,
      J14: expense.days && group.length ? Math.round(groupTotal.perDiem / (expense.days * group.length)) : 0,
      K14: groupTotal.perDiem,
      M14: 0,
      O14: groupTotal.perDiem,
      H15: "숙박료",
      I15: `${group.length}명 · ${expense.nights}박`,
      J15: lodgingUnit,
      K15: groupTotal.lodging,
      M15: 0,
      O15: groupTotal.lodging,
      H16: "식비",
      I16: `${group.length}명 × ${expense.days}일`,
      J16: mealUnit,
      K16: groupTotal.meal,
      M16: 0,
      O16: groupTotal.meal,
      H17: "준비비",
      I17: "해당없음",
      J17: null,
      K17: null,
      M17: groupTotal.deduction,
      O17: 0,
      H18: "-",
      J18: "합계",
      K18: groupTotal.total,
    });
    await patchSheet(zip, expenseNames[groupIndex], groupPatches);
  }

  const participantNames = participantExpenses.map((item) => item.participant.employeeName).filter(Boolean);
  const reporter = participantExpenses.find((item) => item.participant.id === trip.reporterParticipantId)?.participant
    ?? participantExpenses[0].participant;
  const lines = reportLines(trip);
  const reportPatches = {
    B6: participantNames.join(", "),
    B7: excelSerial(startDate),
    D7: weekday(startDate),
    E7: `${timeLabel(trip.startAt)}~${timeLabel(trip.endAt)}`,
    B8: waypoints.length ? `${statementDestination} (경유: ${outboundWaypoints})` : visitDestination,
    C8: null,
    B9: trip.purpose,
    A26: excelSerial(requestDate),
    D27: reporter.employeeName,
  };
  for (let row = 12; row <= 23; row += 1) reportPatches[`B${row}`] = lines[row - 12] ?? null;
  await patchSheet(zip, "출장복명서", reportPatches);

  for (const sheetName of applicationNames) {
    await setSheetPrintLayout(zip, sheetName, {
      orientation: "portrait",
      margins: {
        left: 0.7874015748031497,
        right: 0.7874015748031497,
        top: 0.5905511811023623,
        bottom: 0.5905511811023623,
        header: 0.5905511811023623,
        footer: 0.5905511811023623,
      },
    });
  }
  for (const sheetName of expenseNames) {
    await setSheetPrintLayout(zip, sheetName, {
      orientation: "landscape",
      centered: true,
      margins: {
        left: 0.5118110236220472,
        right: 0.5118110236220472,
        top: 0.3543307086614174,
        bottom: 0.3543307086614174,
        header: 0.3149606299212598,
        footer: 0.3149606299212598,
      },
    });
  }
  await setSheetPrintLayout(zip, "출장복명서", {
    orientation: "portrait",
    fitOnePage: true,
    margins: {
      left: 0.984251968503937,
      right: 0.984251968503937,
      top: 0.7874015748031497,
      bottom: 0.5905511811023623,
      header: 0.5905511811023623,
      footer: 0.5905511811023623,
    },
  });

  await orderWorksheets(zip, [...applicationNames, ...expenseNames, "출장복명서"]);

  const workbookDoc = xml(await zip.file("xl/workbook.xml").async("string"));
  const calcPr = workbookDoc.getElementsByTagNameNS(XML_NS, "calcPr")[0] ?? workbookDoc.documentElement.appendChild(node(workbookDoc, "calcPr"));
  calcPr.setAttribute("fullCalcOnLoad", "1");
  calcPr.setAttribute("forceFullCalc", "1");
  zip.file("xl/workbook.xml", new XMLSerializer().serializeToString(workbookDoc));

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function travelWorkbookFilename(trip) {
  const date = String(trip.startAt || new Date().toISOString()).slice(0, 10).replaceAll("-", "");
  const participants = Array.isArray(trip.participants) && trip.participants.length ? trip.participants : [{ employeeName: trip.employeeName }];
  const primaryName = participants[0]?.employeeName || "출장자";
  const companionLabel = participants.length > 1 ? `_외${participants.length - 1}명` : "";
  return `출장정산_${date}_${primaryName}${companionLabel}.xlsx`;
}
