const DATE_PATTERN = /20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}/g;
const TIME_PATTERN = /(?:[01]?\d|2[0-3]):[0-5]\d/g;
const MAX_HWPX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_HWPX_SECTION_COUNT = 32;
const MAX_HWPX_EXPANDED_TEXT_SIZE = 12 * 1024 * 1024;

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanPurpose(value) {
  const cleaned = normalizeText(value)
    .replace(/^\s*[~\-–—:·,]+\s*/, "")
    .replace(/\s*[~]+\s*$/, "")
    .replace(/\(\s*/g, "(")
    .replace(/\s*\)/g, ")")
    .replace(/\s*,\s*/g, ", ")
    .trim();
  return cleaned
    .replace(/^\((?=[^)]*$)/, "")
    .replace(/,\s*$/, "")
    .trim();
}

const LOCATION_HINT_PATTERN = /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|시|군|구|읍|면|동|터미널|대학교|공단|사업단|센터|본사|지사)/;

function isDateOrTimeLine(value) {
  const text = String(value ?? "");
  return /20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}/.test(text) || /(?:[01]?\d|2[0-3]):[0-5]\d/.test(text);
}

function isLocationHint(value) {
  return LOCATION_HINT_PATTERN.test(String(value ?? ""));
}

function cleanDestinationFragment(value) {
  return normalizeText(value)
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

const TRAVEL_FIELD_BOUNDARY_PATTERN = /(?:문서번호|문서제목|출장\s*구분|출장\s*목적|출장지\s*(?:\(\s*방문기관\s*\))?|방문기관|출장\s*(?:기간|일시|일정)|출발\s*일시|도착\s*일시|출발지|교통\s*도착지|교통수단|출장자|부서|직급|직위|성명)/;

function labeledFieldValue(lines, labelPattern) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] ?? "");
    const match = line.match(labelPattern);
    if (!match) continue;
    let value = line
      .slice((match.index ?? 0) + match[0].length)
      .replace(/^\s*[:：]\s*/, "")
      .trim();
    const boundaryIndex = value.search(TRAVEL_FIELD_BOUNDARY_PATTERN);
    if (boundaryIndex > 0) value = value.slice(0, boundaryIndex).trim();
    if (value) return value;
    const next = String(lines[index + 1] ?? "").trim();
    if (next && !TRAVEL_FIELD_BOUNDARY_PATTERN.test(next)) return next;
  }
  return "";
}

function meaningfulLabeledValue(value, ignoredTokens = []) {
  const normalized = normalizeText(value);
  const token = normalized.replace(/[^가-힣A-Za-z0-9]/g, "");
  if (!token || ignoredTokens.includes(token)) return "";
  return normalized;
}

function toIsoDate(value) {
  const match = String(value ?? "").match(/(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function transportCode(text) {
  if (/법인차량|법인차/.test(text)) return "corporate";
  if (/자가차량|자가용|개인차량|개인차/.test(text)) return "personal";
  if (/대중교통|시외버스|철도|KTX|SRT|버스/.test(text)) return "public";
  return "";
}

const TRANSPORT_PATTERN = /(법인차량|법인차|자가차량|자가용|개인차량|개인차|대중교통|시외버스|고속버스|철도|KTX|SRT)/;
const PARTICIPANT_ROW_PATTERN = /^(.+?(?:사업단|센터|본부|실|팀|부|단|원))\s+([0-9]+\s*급|[가-힣A-Za-z·]+)\s+([가-힣]{2,5})\s+(.+?)\s*(?:~)?\s*(?=법인차량|법인차|자가차량|자가용|개인차량|개인차|대중교통|시외버스|고속버스|철도|KTX|SRT)/;

function participantRows(lines, fallbackName) {
  const matches = lines
    .filter((line) => TRANSPORT_PATTERN.test(line))
    .map((line) => ({ line, row: line.match(PARTICIPANT_ROW_PATTERN) }))
    .filter(({ row }) => Boolean(row))
    .map(({ row }, index) => ({
      id: `participant-${index + 1}`,
      department: row[1].trim(),
      position: row[2].replace(/\s+/g, ""),
      employeeName: row[3].trim(),
      purpose: cleanPurpose(row[4]),
      transportClaimant: index === 0,
    }));

  const unique = matches.filter((participant, index, all) => (
    all.findIndex((item) => item.employeeName === participant.employeeName && item.department === participant.department) === index
  ));
  if (unique.length) return unique;

  return [{
    id: "participant-1",
    department: "",
    position: "",
    employeeName: fallbackName,
    purpose: "",
    transportClaimant: true,
  }];
}

export function parseApprovedTravelText(rawText) {
  const text = normalizeText(rawText);
  const flat = text.replace(/\s+/g, " ");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const documentNumberParts = flat.match(/문서번호\s*([가-힣A-Za-z0-9()·]+)\s*-\s*(\d+)/);
  const documentNumber = documentNumberParts ? `${documentNumberParts[1]}-${documentNumberParts[2]}` : "";
  const titleLine = lines.find((line) => line.includes("문서제목")) ?? "";
  const documentTitle = titleLine
    .replace(/^.*?문서제목\s*/, "")
    .replace(/\s*_\s*/g, "_")
    .replace(/\s+/g, "")
    .trim();
  const titleName = documentTitle.split("_").filter(Boolean).at(-1)?.replace(/\.pdf$/i, "") ?? "";
  const travelPeriod = labeledFieldValue(lines, /출장\s*(?:기간|일시|일정)/);
  const periodDates = travelPeriod.match(DATE_PATTERN) ?? [];
  const periodTimes = travelPeriod.match(TIME_PATTERN) ?? [];
  const dates = periodDates.length ? periodDates : flat.match(DATE_PATTERN) ?? [];
  const times = periodTimes.length ? periodTimes : flat.match(TIME_PATTERN) ?? [];
  const startDate = toIsoDate(dates[0]);
  const endDate = toIsoDate(dates[1] ?? dates[0]);
  const startTime = times[0] ?? "09:00";
  const endTime = times[1] ?? "18:00";

  const transportLineIndex = lines.findIndex((line) => TRANSPORT_PATTERN.test(line));
  const rowLine = transportLineIndex >= 0 ? lines[transportLineIndex] : flat;
  const parsedParticipants = participantRows(lines, titleName);
  const primary = parsedParticipants[0];
  const department = primary.department || documentNumber.split("-")[0] || "";
  const position = primary.position;
  const employeeName = primary.employeeName || titleName;
  const participants = parsedParticipants.map((participant, index) => ({
    ...participant,
    department: participant.department || (index === 0 ? department : ""),
    employeeName: participant.employeeName || (index === 0 ? employeeName : ""),
  }));
  const transportMatch = rowLine.match(TRANSPORT_PATTERN) ?? flat.match(TRANSPORT_PATTERN);
  const transportText = transportMatch?.[1] ?? "";

  const startTimeIndex = times[0] ? lines.findIndex((line) => line.includes(times[0])) : -1;
  const endTimeIndex = times[1] ? lines.findIndex((line, index) => index > startTimeIndex && line.includes(times[1])) : -1;
  const rowPurpose = cleanPurpose(primary.purpose);
  const rowPurposeLooksLikeDestination = Boolean(rowPurpose && /~\s*\(/.test(rowLine));
  const rowPurposeUsable = Boolean(rowPurpose && !rowPurposeLooksLikeDestination);
  const purposeSegments = [];
  const purposeStart = startTimeIndex >= 0 ? startTimeIndex + 1 : 0;
  const purposeEnd = transportLineIndex >= 0 ? transportLineIndex : (endTimeIndex >= 0 ? endTimeIndex : lines.length);
  lines.slice(purposeStart, purposeEnd).forEach((line) => {
    if (!line || isDateOrTimeLine(line) || isLocationHint(line) || /붙임|방문기관|출장지|출장목적|출장기간/.test(line)) return;
    if (/^\(?\s*[^)]*\)?$/.test(line) && /[()]/.test(line)) return;
    purposeSegments.push(cleanPurpose(line));
  });
  if (transportLineIndex >= 0 && endTimeIndex > transportLineIndex) {
    lines.slice(transportLineIndex + 1, endTimeIndex).forEach((line) => {
      if (!line || isDateOrTimeLine(line) || /붙임|방문기관|출장지|출장목적|출장기간/.test(line)) return;
      if (/[()]/.test(line)) return;
      if (!rowPurposeUsable) purposeSegments.push(cleanPurpose(line));
    });
  }
  const labeledPurpose = meaningfulLabeledValue(
    cleanPurpose(labeledFieldValue(lines, /출장\s*목적/)),
    ["목적", "구체적"],
  );
  const purpose = labeledPurpose || (rowPurposeUsable ? rowPurpose : purposeSegments.filter(Boolean).join(" ") || rowPurpose);
  const participantsWithPurpose = participants.map((participant) => ({
    ...participant,
    purpose: participant.purpose && !rowPurposeLooksLikeDestination ? participant.purpose : purpose,
  }));

  const destinationParts = [];
  const locationSearchStart = Math.max(0, startTimeIndex >= 0 ? startTimeIndex - 2 : 0);
  const locationSearchEnd = Math.min(lines.length, endTimeIndex >= 0 ? endTimeIndex + 1 : lines.length);
  lines.slice(locationSearchStart, locationSearchEnd).forEach((line) => {
    if (!line || isDateOrTimeLine(line) || /붙임|방문기관|출장지|출장목적|출장기간/.test(line)) return;
    if (line === rowLine || /법인차량|법인차|자가차량|자가용|개인차량|개인차|대중교통|시외버스|고속버스|철도|KTX|SRT/.test(line)) return;
    if (isLocationHint(line) && !purposeSegments.includes(cleanPurpose(line))) destinationParts.push(cleanDestinationFragment(line));
  });
  if (transportLineIndex >= 0) {
    const transportDestinationFragment = rowLine.match(/~\s*(\([^,)]*[,，])/i)?.[1];
    if (transportDestinationFragment) destinationParts.push(cleanDestinationFragment(transportDestinationFragment));
    lines.slice(transportLineIndex + 1, locationSearchEnd).forEach((line) => {
      if (/[()]/.test(line) || (rowPurposeUsable && !isDateOrTimeLine(line))) destinationParts.push(cleanDestinationFragment(line));
    });
  }
  if (!destinationParts.length && transportText) {
    const beforeTransport = flat.slice(0, flat.lastIndexOf(transportText));
    const tail = beforeTransport.match(/20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}\s+\d{1,2}:\d{2}\s+(.+)$/);
    if (tail?.[1]) destinationParts.push(cleanDestinationFragment(tail[1]));
  }
  const labeledDestination = meaningfulLabeledValue(
    cleanDestinationFragment(labeledFieldValue(lines, /출장지\s*(?:\(\s*방문기관\s*\))?|방문기관/)),
    ["출장지", "방문기관"],
  );
  const destination = labeledDestination || [...new Set(destinationParts)]
    .join(" ")
    .replace(/\s*붙임.*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const missing = [];
  if (!department) missing.push("부서");
  if (!position) missing.push("직급/직위");
  if (!employeeName) missing.push("성명");
  if (!purpose) missing.push("출장목적");
  if (!startDate || !endDate) missing.push("출장기간");
  if (!destination) missing.push("출장지");

  return {
    documentNumber,
    documentTitle,
    department,
    position,
    employeeName,
    participants: participantsWithPurpose,
    reporterParticipantId: participants[0]?.id || "participant-1",
    purpose,
    destination,
    waypoints: [],
    startAt: startDate ? `${startDate}T${startTime}` : "",
    endAt: endDate ? `${endDate}T${endTime}` : "",
    transportType: transportCode(transportText),
    parsedText: text,
    missing,
  };
}

export async function extractApprovedTravelPdf(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const grouped = new Map();
    content.items.forEach((item) => {
      const y = Math.round(item.transform?.[5] ?? 0);
      if (!grouped.has(y)) grouped.set(y, []);
      grouped.get(y).push({ x: item.transform?.[4] ?? 0, text: item.str ?? "" });
    });
    [...grouped.entries()]
      .sort((left, right) => right[0] - left[0])
      .forEach(([, items]) => {
        const line = items.sort((left, right) => left.x - right.x).map((item) => item.text).join(" ").trim();
        if (line) lines.push(line);
      });
  }
  return parseApprovedTravelText(lines.join("\n"));
}

function hwpxElementChildren(node, localName) {
  return Array.from(node?.childNodes ?? [])
    .filter((child) => child.nodeType === 1 && child.localName === localName);
}

function hwpxHasNestedTableAncestor(node, boundary) {
  let current = node?.parentElement ?? node?.parentNode;
  while (current && current !== boundary) {
    if (current.localName === "tbl") return true;
    current = current.parentElement ?? current.parentNode;
  }
  return false;
}

function hwpxParagraphText(paragraph) {
  return Array.from(paragraph.getElementsByTagNameNS("*", "t"))
    .map((node) => node.textContent ?? "")
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function hwpxCellParagraphs(cell, includeNested = false) {
  return Array.from(cell.getElementsByTagNameNS("*", "p"))
    .filter((paragraph) => includeNested || !hwpxHasNestedTableAncestor(paragraph, cell))
    .map(hwpxParagraphText)
    .filter(Boolean);
}

function hwpxLogicalTableRows(table) {
  const activeSpans = new Map();
  return hwpxElementChildren(table, "tr").map((tableRow, rowIndex) => {
    const values = [];
    activeSpans.forEach((entry, column) => {
      if (entry.until >= rowIndex) values[column] = entry.value;
      else activeSpans.delete(column);
    });

    hwpxElementChildren(tableRow, "tc").forEach((cell) => {
      const address = hwpxElementChildren(cell, "cellAddr")[0];
      const span = hwpxElementChildren(cell, "cellSpan")[0];
      const parsedColumn = Number(address?.getAttribute("colAddr"));
      const column = Number.isSafeInteger(parsedColumn) && parsedColumn >= 0 ? parsedColumn : values.length;
      const parsedColumnSpan = Number(span?.getAttribute("colSpan"));
      const parsedRowSpan = Number(span?.getAttribute("rowSpan"));
      const columnSpan = Number.isSafeInteger(parsedColumnSpan) && parsedColumnSpan > 0 ? parsedColumnSpan : 1;
      const rowSpan = Number.isSafeInteger(parsedRowSpan) && parsedRowSpan > 0 ? parsedRowSpan : 1;
      const paragraphs = hwpxCellParagraphs(cell);
      const value = paragraphs.join("\n") || hwpxCellParagraphs(cell, true).join("\n");

      for (let offset = 0; offset < columnSpan; offset += 1) {
        values[column + offset] = value;
        if (rowSpan > 1) {
          activeSpans.set(column + offset, { value, until: rowIndex + rowSpan - 1 });
        }
      }
    });
    return values;
  });
}

function hwpxSectionContent(xml) {
  const documentXml = new DOMParser().parseFromString(xml, "application/xml");
  if (documentXml.getElementsByTagName("parsererror").length) {
    throw new Error("HWPX 표 구조를 해석하지 못했습니다.");
  }

  const topTables = Array.from(documentXml.getElementsByTagNameNS("*", "tbl"))
    .filter((table) => !hwpxHasNestedTableAncestor(table, documentXml.documentElement));
  const tables = topTables.map(hwpxLogicalTableRows).filter((rows) => rows.length);
  const paragraphs = Array.from(documentXml.getElementsByTagNameNS("*", "p"))
    .filter((paragraph) => (
      !hwpxHasNestedTableAncestor(paragraph, documentXml.documentElement)
      && paragraph.getElementsByTagNameNS("*", "tbl").length === 0
    ))
    .map(hwpxParagraphText)
    .filter(Boolean);
  const tableLines = tables.flatMap((rows) => rows
    .map((row) => row.map((cell) => normalizeText(cell)).filter(Boolean).join("\t"))
    .filter(Boolean));
  return { lines: [...paragraphs, ...tableLines], tables };
}

function normalizedHwpxHeader(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^가-힣A-Za-z0-9]/g, "")
    .toLowerCase();
}

function hwpxColumn(headers, patterns) {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function hwpxLabeledValue(tables, patterns) {
  for (const table of tables) {
    for (const row of table) {
      for (let labelIndex = 0; labelIndex < row.length; labelIndex += 1) {
        const label = normalizedHwpxHeader(row[labelIndex]);
        if (!patterns.some((pattern) => pattern.test(label))) continue;
        for (let valueIndex = labelIndex + 1; valueIndex < row.length; valueIndex += 1) {
          const value = normalizeText(row[valueIndex]);
          const normalizedValue = normalizedHwpxHeader(value);
          if (normalizedValue && normalizedValue !== label) return value;
        }
      }
    }
  }
  return "";
}

function hwpxPreviewTables(previewText) {
  const rows = String(previewText ?? "")
    .split(/\r?\n/)
    .map((line) => Array.from(line.matchAll(/<([^>]*)>/g), (match) => normalizeText(match[1])))
    .filter((row) => row.length > 1);
  return rows.length ? [rows] : [];
}

function parsedMissing(parsed) {
  const missing = [];
  if (!parsed.department) missing.push("부서");
  if (!parsed.position) missing.push("직급/직위");
  if (!parsed.employeeName) missing.push("성명");
  if (!parsed.purpose) missing.push("출장목적");
  if (!parsed.startAt || !parsed.endAt) missing.push("출장기간");
  if (!parsed.destination) missing.push("출장지");
  return missing;
}

export function parseApprovedTravelHwpxTables(tables, parsedText = "") {
  const structuredRows = [];
  for (const table of Array.isArray(tables) ? tables : []) {
    const headerIndex = table.findIndex((row) => {
      const headers = row.map(normalizedHwpxHeader);
      return hwpxColumn(headers, [/^부서$/]) >= 0
        && hwpxColumn(headers, [/^(?:성명|이름)$/]) >= 0
        && hwpxColumn(headers, [/^(?:출장목적.*|목적)$/]) >= 0
        && hwpxColumn(headers, [/^출장(?:기간|일시|일정)$/]) >= 0
        && hwpxColumn(headers, [/^(?:출장지(?:방문기관)?|방문기관)$/]) >= 0;
    });
    if (headerIndex < 0) continue;

    const headers = table[headerIndex].map(normalizedHwpxHeader);
    const columns = {
      department: hwpxColumn(headers, [/^부서$/]),
      position: hwpxColumn(headers, [/^(?:직위책|직위직책|직급직위|직위|직급|직책)$/]),
      name: hwpxColumn(headers, [/^(?:성명|이름)$/]),
      purpose: hwpxColumn(headers, [/^(?:출장목적.*|목적)$/]),
      period: hwpxColumn(headers, [/^출장(?:기간|일시|일정)$/]),
      destination: hwpxColumn(headers, [/^(?:출장지(?:방문기관)?|방문기관)$/]),
      note: hwpxColumn(headers, [/^(?:비고|교통수단)$/]),
    };

    for (const row of table.slice(headerIndex + 1)) {
      if (row.some((cell) => /^붙임/.test(normalizedHwpxHeader(cell)))) break;
      const employeeName = normalizeText(row[columns.name] ?? "");
      if (!employeeName || /^(?:성명|이름)$/.test(normalizedHwpxHeader(employeeName))) continue;
      structuredRows.push({
        department: normalizeText(row[columns.department] ?? ""),
        position: normalizeText(row[columns.position] ?? "").replace(/\s+/g, ""),
        employeeName,
        purpose: cleanPurpose(row[columns.purpose] ?? ""),
        period: normalizeText(row[columns.period] ?? ""),
        destination: cleanDestinationFragment(row[columns.destination] ?? ""),
        transportText: normalizeText(row[columns.note] ?? ""),
      });
    }
  }

  if (!structuredRows.length) return null;
  const shared = {
    department: structuredRows.find((row) => row.department)?.department ?? "",
    position: structuredRows.find((row) => row.position)?.position ?? "",
    purpose: structuredRows.find((row) => row.purpose)?.purpose ?? "",
    period: structuredRows.find((row) => row.period)?.period ?? "",
    destination: structuredRows.find((row) => row.destination)?.destination ?? "",
    transportText: structuredRows.find((row) => row.transportText)?.transportText ?? "",
  };
  const completedRows = structuredRows.map((row) => ({
    ...row,
    department: row.department || shared.department,
    position: row.position || shared.position,
    purpose: row.purpose || shared.purpose,
    period: row.period || shared.period,
    destination: row.destination || shared.destination,
    transportText: row.transportText || shared.transportText,
  }));
  const uniqueRows = completedRows.filter((row, index, rows) => (
    rows.findIndex((candidate) => (
      candidate.employeeName === row.employeeName && candidate.department === row.department
    )) === index
  ));
  const primary = uniqueRows[0];
  const dates = primary.period.match(DATE_PATTERN) ?? [];
  const times = primary.period.match(TIME_PATTERN) ?? [];
  const startDate = toIsoDate(dates[0]);
  const endDate = toIsoDate(dates[1] ?? dates[0]);
  const startTime = times[0] ?? "09:00";
  const endTime = times[1] ?? "18:00";
  const result = {
    documentNumber: hwpxLabeledValue(tables, [/^문서번호$/]),
    documentTitle: hwpxLabeledValue(tables, [/^문서제목$/]),
    department: primary.department,
    position: primary.position,
    employeeName: primary.employeeName,
    participants: uniqueRows.map((row, index) => ({
      id: `participant-${index + 1}`,
      department: row.department,
      position: row.position,
      employeeName: row.employeeName,
      purpose: row.purpose,
      transportClaimant: index === 0,
    })),
    reporterParticipantId: "participant-1",
    purpose: primary.purpose,
    destination: primary.destination,
    waypoints: [],
    startAt: startDate ? `${startDate}T${startTime}` : "",
    endAt: endDate ? `${endDate}T${endTime}` : "",
    transportType: primary.transportText ? transportCode(primary.transportText) : "",
    parsedText: normalizeText(parsedText),
  };
  return { ...result, missing: parsedMissing(result) };
}

export async function extractApprovedTravelHwpx(file) {
  if (Number(file?.size) > MAX_HWPX_FILE_SIZE) throw new Error("HWPX 파일은 4MB 이하만 읽을 수 있습니다.");
  const { default: JSZip } = await import("jszip");
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error("HWPX 파일이 손상되었거나 지원하지 않는 형식입니다.");
  }

  const sectionNames = Object.keys(zip.files)
    .filter((name) => /^Contents\/section\d+\.xml$/i.test(name))
    .sort((left, right) => Number(left.match(/\d+/)?.[0] || 0) - Number(right.match(/\d+/)?.[0] || 0));
  if (!sectionNames.length) throw new Error("HWPX 본문을 찾지 못했습니다.");
  if (sectionNames.length > MAX_HWPX_SECTION_COUNT) throw new Error("HWPX 본문 구성이 너무 큽니다. 원본을 정리한 뒤 다시 올려주세요.");

  const declaredExpandedSize = sectionNames.reduce((total, name) => (
    total + Math.max(0, Number(zip.file(name)?._data?.uncompressedSize) || 0)
  ), 0);
  if (declaredExpandedSize > MAX_HWPX_EXPANDED_TEXT_SIZE) {
    throw new Error("HWPX 압축 해제 크기가 너무 큽니다. 원본을 정리한 뒤 다시 올려주세요.");
  }

  const sectionXml = [];
  let expandedSize = 0;
  for (const name of sectionNames) {
    const xml = await zip.file(name).async("string");
    expandedSize += xml.length;
    if (expandedSize > MAX_HWPX_EXPANDED_TEXT_SIZE) {
      throw new Error("HWPX 압축 해제 크기가 너무 큽니다. 원본을 정리한 뒤 다시 올려주세요.");
    }
    sectionXml.push(xml);
  }
  const sections = sectionXml.map(hwpxSectionContent);
  const lines = sections.flatMap((section) => section.lines);
  const tables = sections.flatMap((section) => section.tables);
  const parsedText = lines.join("\n");
  const structured = parseApprovedTravelHwpxTables(tables, parsedText);
  if (structured) return structured;

  const preview = zip.file("Preview/PrvText.txt");
  if ((Number(preview?._data?.uncompressedSize) || 0) > MAX_HWPX_EXPANDED_TEXT_SIZE) {
    throw new Error("HWPX 미리보기 데이터가 너무 큽니다.");
  }
  const previewText = preview ? normalizeText(await preview.async("string")) : "";
  const previewStructured = parseApprovedTravelHwpxTables(hwpxPreviewTables(previewText), previewText);
  if (previewStructured) return previewStructured;
  const fallbackText = previewText || normalizeText(parsedText);
  if (!fallbackText) throw new Error("HWPX에서 읽을 수 있는 출장 정보를 찾지 못했습니다.");
  return parseApprovedTravelText(fallbackText);
}
