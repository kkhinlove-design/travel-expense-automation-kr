// 공용 운임 기준표 엑셀 파서.
// 직원 일괄 등록(lib/staff-account-import.js)과 같은 방식으로 헤더 별칭과
// 열 순서 변경을 허용한다. 기관마다 쓰던 양식을 그대로 올릴 수 있게 하기 위함이다.

const HEADER_ALIASES = {
  origin: ["출발지", "출발", "기점", "origin", "from"],
  destination: ["도착지", "도착", "종점", "destination", "to"],
  outboundFare: ["가는 길 운임", "가는길", "가는 길", "편도 운임", "출발 운임", "outbound", "outbound fare"],
  returnFare: ["오는 길 운임", "오는길", "오는 길", "복귀 운임", "귀로 운임", "return", "return fare"],
};

// 지명에 공백이 들어갈 수 있어 "가 나"+"다"와 "가"+"나 다"가 같은 키로 뭉치지 않도록
// 엑셀 셀에 나올 수 없는 문자를 구분자로 쓴다.
const ROUTE_KEY_SEPARATOR = String.fromCharCode(0);
const MAX_FARE = 10_000_000;

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/^﻿/, "")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function columnIndex(row, aliases) {
  const wanted = new Set(aliases.map(normalizeHeader));
  return row.findIndex((cell) => wanted.has(normalizeHeader(cell)));
}

function toFare(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").replace(/[₩원,\s]/gi, "");
  if (!text) return 0;
  const number = Number(text);
  return Number.isFinite(number) ? number : Number.NaN;
}

function normalizedPlace(value) {
  return String(value ?? "").toLocaleLowerCase("ko-KR");
}

export function routeKey(origin, destination) {
  return `${normalizedPlace(origin)}${ROUTE_KEY_SEPARATOR}${normalizedPlace(destination)}`;
}

export function parseFareCatalogRows(rows, { maxRoutes = 500, headerSearchLimit = 20 } = {}) {
  if (!Array.isArray(rows)) throw new Error("운임 파일을 읽지 못했습니다.");

  let headerIndex = -1;
  let columns = null;
  for (let index = 0; index < Math.min(rows.length, headerSearchLimit); index += 1) {
    const row = Array.isArray(rows[index]) ? rows[index] : [];
    const nextColumns = {
      origin: columnIndex(row, HEADER_ALIASES.origin),
      destination: columnIndex(row, HEADER_ALIASES.destination),
      outboundFare: columnIndex(row, HEADER_ALIASES.outboundFare),
      returnFare: columnIndex(row, HEADER_ALIASES.returnFare),
    };
    if (Object.values(nextColumns).every((column) => column >= 0)) {
      headerIndex = index;
      columns = nextColumns;
      break;
    }
  }

  if (headerIndex < 0 || !columns) {
    throw new Error("운임 양식에서 출발지, 도착지, 가는 길 운임, 오는 길 운임 헤더 행을 찾지 못했습니다.");
  }

  const seen = new Set();
  const parsed = [];
  const errors = [];
  const fareOutOfRange = (fare) => !Number.isSafeInteger(fare) || fare < 0 || fare > MAX_FARE;

  rows.slice(headerIndex + 1).forEach((rawRow, offset) => {
    const row = Array.isArray(rawRow) ? rawRow : [];
    const rowNumber = headerIndex + offset + 2;
    const origin = String(row[columns.origin] ?? "").replace(/\s+/g, " ").trim();
    const destination = String(row[columns.destination] ?? "").replace(/\s+/g, " ").trim();
    const rawOutbound = row[columns.outboundFare];
    const rawReturn = row[columns.returnFare];
    if (!origin && !destination && !String(rawOutbound ?? "") && !String(rawReturn ?? "")) return;

    const outboundFare = toFare(rawOutbound);
    const returnFare = toFare(rawReturn);
    const key = routeKey(origin, destination);

    if (!origin || !destination) errors.push(`${rowNumber}행: 출발지와 도착지를 모두 입력하세요.`);
    else if (normalizedPlace(origin) === normalizedPlace(destination)) errors.push(`${rowNumber}행: 출발지와 도착지는 달라야 합니다.`);
    else if (fareOutOfRange(outboundFare) || fareOutOfRange(returnFare)) errors.push(`${rowNumber}행: 운임은 0~10,000,000원 정수로 입력하세요.`);
    else if (!outboundFare && !returnFare) errors.push(`${rowNumber}행: 가는 길 또는 오는 길 운임을 입력하세요.`);
    else if (seen.has(key)) errors.push(`${rowNumber}행: 같은 출발지·도착지가 중복됩니다.`);
    else {
      seen.add(key);
      parsed.push({ origin, destination, outboundFare, returnFare, rowNumber });
    }
  });

  if (errors.length) throw new Error(errors.slice(0, 12).join(" · "));
  if (parsed.length > maxRoutes) throw new Error(`한 번에 ${maxRoutes}개 노선까지만 업로드할 수 있습니다.`);
  if (!parsed.length) throw new Error("업로드할 운임 노선이 없습니다.");
  return parsed;
}
