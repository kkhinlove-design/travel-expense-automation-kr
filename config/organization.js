function text(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function optionalUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

export const DEFAULT_ORIGIN_BASES = Object.freeze([
  "전주",
  "군산",
  "김제",
  "남원",
  "완주",
  "진안",
  "무주",
  "장수",
  "임실",
  "고창",
  "부안",
]);

export function parseOriginBases(value, fallback = DEFAULT_ORIGIN_BASES) {
  const entries = String(value ?? "")
    .split(/[,;\n]/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const uniqueEntries = [...new Set(entries)];
  return Object.freeze(uniqueEntries.length ? uniqueEntries : [...fallback]);
}

const originBases = parseOriginBases(process.env.NEXT_PUBLIC_ORIGIN_BASES);

export const ORGANIZATION_CONFIG = Object.freeze({
  appName: text(process.env.NEXT_PUBLIC_APP_NAME, "출장완료"),
  serviceName: text(process.env.NEXT_PUBLIC_SERVICE_NAME, "출장서류 자동화"),
  organizationName: text(process.env.NEXT_PUBLIC_ORGANIZATION_NAME, "소속 기관"),
  brandEnglish: text(process.env.NEXT_PUBLIC_BRAND_ENGLISH, "BUSINESS TRIP DESK"),
  defaultOrigin: text(process.env.NEXT_PUBLIC_DEFAULT_ORIGIN, originBases[0]),
  originBases,
  publicAppUrl: optionalUrl(process.env.NEXT_PUBLIC_APP_URL),
  ogImagePath: text(process.env.NEXT_PUBLIC_OG_IMAGE_PATH, "/og-travel.png"),
});

export const APP_TITLE = `${ORGANIZATION_CONFIG.appName} | ${ORGANIZATION_CONFIG.serviceName}`;
export const APP_DESCRIPTION = "승인된 출장신청 PDF·HWPX로 여비지급신청서, 지출명세서, 출장복명서를 한 번에 완성합니다.";
export const APP_FOOTER = `${ORGANIZATION_CONFIG.appName} · ${ORGANIZATION_CONFIG.organizationName} ${ORGANIZATION_CONFIG.serviceName}`;
