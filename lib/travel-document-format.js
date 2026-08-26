const PROVINCE_PREFIX_PATTERN = /^(?:전북(?:특별자치도)?|전라북도|전남|전라남도|충북|충청북도|충남|충청남도|경북|경상북도|경남|경상남도|강원(?:특별자치도)?|경기도)\s*/;

const COMMON_REGION_NAMES = Object.freeze([
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "제주",
  "전주", "군산", "익산", "정읍", "남원", "김제", "완주", "진안", "무주", "장수", "임실", "순창", "고창", "부안",
]);

function normalizedDestination(value) {
  return String(value ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 방문기관명이나 업무 목적이 함께 들어온 출장지에서 제출 서류에 쓸 지역명만 고른다.
 */
export function travelDestinationRegion(value) {
  const original = normalizedDestination(value);
  if (!original) return "";

  const withoutProvince = original.replace(PROVINCE_PREFIX_PATTERN, "").trim();
  const searchable = withoutProvince || original;
  const tokens = searchable.split(/\s+/);
  const namedRegion = COMMON_REGION_NAMES.find((region) => tokens.some((token) => token.startsWith(region)));
  if (namedRegion) return namedRegion;

  const administrativeRegion = searchable.match(/(?:^|\s)([가-힣]{2,8}?)(?:특별자치시|특별시|광역시|시|군)/)?.[1];
  if (administrativeRegion) return administrativeRegion;

  const firstToken = searchable.split(/\s+/)[0] || original;
  return firstToken.replace(/(?:특별자치시|특별시|광역시|시|군|구)$/, "");
}

export function travelTransportLabel(transportType) {
  if (transportType === "corporate") return "법인차";
  if (transportType === "personal") return "개인차";
  return "대중교통";
}

/**
 * 법인차 비용 대표자가 아닌 출장자는 지출명세서에서 동승 사실을 분명히 표시한다.
 */
export function participantTravelTransportLabel(trip, participant) {
  const label = travelTransportLabel(trip?.transportType);
  return label === "법인차" && participant?.transportClaimant === false
    ? "법인차(동승)"
    : label;
}
