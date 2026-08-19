import { routeKey } from "./fare-catalog-import.js";

const MAX_FARE = 10_000_000;
const HEADER_ALIASES = {
  origin: ["출발 시·군", "출발 시군", "출발지", "출발"],
  destination: ["도착지", "도착", "종점"],
  fare: ["요금", "운임", "편도 운임", "편도요금"],
  routeType: ["노선구분", "노선 구분"],
  grade: ["버스등급", "버스 등급", "등급"],
  schedule: ["첫차/운행정보", "운행정보", "첫차"],
  provider: ["수집처", "출처"],
  collectedAt: ["수집일시", "수집 일시", "기준일시"],
};

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function headerColumn(row, aliases) {
  const wanted = new Set(aliases.map(normalizeHeader));
  return row.findIndex((cell) => wanted.has(normalizeHeader(cell)));
}

function clean(value, max = 160) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function parseFare(value) {
  const text = String(value ?? "").replace(/[₩원,\s]/gi, "");
  if (!text) return Number.NaN;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_FARE
    ? number
    : Number.NaN;
}

function gradePriority(value) {
  const grade = normalizeHeader(value);
  if (grade.includes("우등")) return 0;
  if (grade.includes("일반")) return 1;
  if (grade.includes("프리미엄")) return 2;
  return 3;
}

export function parseCsvMatrix(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text ?? "").replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"' && !field) quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function preferredRouteRow(rows, routeLabel) {
  const ranked = [...rows].sort((left, right) => (
    gradePriority(left.grade) - gradePriority(right.grade)
    || left.rowNumber - right.rowNumber
  ));
  const bestPriority = gradePriority(ranked[0]?.grade);
  const bestRows = ranked.filter((row) => gradePriority(row.grade) === bestPriority);
  const fares = new Set(bestRows.map((row) => row.fare));
  if (fares.size > 1) {
    throw new Error(`${routeLabel}: 같은 우선 등급의 요금이 여러 개입니다. Google 시트에서 금액을 하나로 정리해 주세요.`);
  }
  return bestRows[0];
}

export function parseGoogleFareSourceCsv(csvText, { maxRows = 2_000, maxRoutes = 500 } = {}) {
  const matrix = parseCsvMatrix(csvText);
  let headerIndex = -1;
  let columns = null;
  for (let index = 0; index < Math.min(matrix.length, 20); index += 1) {
    const row = matrix[index] || [];
    const nextColumns = Object.fromEntries(
      Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, headerColumn(row, aliases)]),
    );
    if (nextColumns.origin >= 0 && nextColumns.destination >= 0 && nextColumns.fare >= 0) {
      headerIndex = index;
      columns = nextColumns;
      break;
    }
  }
  if (headerIndex < 0 || !columns) {
    throw new Error("Google 운임 시트에서 출발지·도착지·요금 헤더를 찾지 못했습니다.");
  }

  const sourceRows = [];
  const errors = [];
  matrix.slice(headerIndex + 1).forEach((row, offset) => {
    if (!row.some((value) => clean(value))) return;
    const rowNumber = headerIndex + offset + 2;
    const origin = clean(row[columns.origin]);
    const destination = clean(row[columns.destination]);
    const fare = parseFare(row[columns.fare]);
    if (!origin || !destination) errors.push(`${rowNumber}행: 출발지와 도착지를 모두 입력해 주세요.`);
    else if (origin.toLocaleLowerCase("ko-KR") === destination.toLocaleLowerCase("ko-KR")) errors.push(`${rowNumber}행: 출발지와 도착지는 서로 달라야 합니다.`);
    else if (!Number.isFinite(fare)) errors.push(`${rowNumber}행: 요금은 1원 이상 1,000만원 이하의 정수여야 합니다.`);
    else {
      sourceRows.push({
        origin,
        destination,
        fare,
        routeType: columns.routeType >= 0 ? clean(row[columns.routeType], 80) : "",
        grade: columns.grade >= 0 ? clean(row[columns.grade], 80) : "",
        schedule: columns.schedule >= 0 ? clean(row[columns.schedule], 200) : "",
        provider: columns.provider >= 0 ? clean(row[columns.provider], 120) : "",
        collectedAt: columns.collectedAt >= 0 ? clean(row[columns.collectedAt], 80) : "",
        rowNumber,
      });
    }
  });

  if (sourceRows.length > maxRows) throw new Error(`Google 운임 시트는 최대 ${maxRows}행까지 읽을 수 있습니다.`);
  if (errors.length) throw new Error(errors.slice(0, 12).join(" · "));
  if (!sourceRows.length) throw new Error("Google 운임 시트에 적용할 요금 데이터가 없습니다.");

  const grouped = new Map();
  sourceRows.forEach((row) => {
    const key = routeKey(row.origin, row.destination);
    grouped.set(key, [...(grouped.get(key) || []), row]);
  });
  if (grouped.size > maxRoutes) throw new Error(`공용 기준표에는 최대 ${maxRoutes}개 노선까지 반영할 수 있습니다.`);

  const selectedByRoute = new Map();
  grouped.forEach((rows, key) => {
    selectedByRoute.set(key, preferredRouteRow(rows, `${rows[0].origin} → ${rows[0].destination}`));
  });

  const rows = [...selectedByRoute.values()].map((selected) => {
    const reverse = selectedByRoute.get(routeKey(selected.destination, selected.origin));
    return {
      origin: selected.origin,
      destination: selected.destination,
      outboundFare: selected.fare,
      returnFare: reverse?.fare ?? selected.fare,
      rowNumber: selected.rowNumber,
      sourceGrade: selected.grade,
      sourceRouteType: selected.routeType,
      sourceProvider: selected.provider,
      sourceCollectedAt: selected.collectedAt,
      reverseFareSource: reverse ? "exact" : "reverse-fallback",
      candidateCount: grouped.get(routeKey(selected.origin, selected.destination))?.length || 1,
    };
  });

  return {
    rows,
    sourceRowCount: sourceRows.length,
    routeCount: rows.length,
    alternativeCount: sourceRows.length - rows.length,
    reversePairCount: rows.filter((row) => row.reverseFareSource === "exact").length,
  };
}
