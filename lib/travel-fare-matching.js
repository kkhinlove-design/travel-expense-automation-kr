import { fareDate, fareEffectiveDate } from "./fare-dates.js";

function normalizedFareLocation(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[()]/g, " ")
    .replace(/전라북도|전북특별자치도|전북|특별자치도|특별시|광역시/g, " ")
    .replace(/(?:시외|고속)?버스터미널|여객터미널|터미널|기차역|철도역|역(?=\s|$)/g, " ")
    .replace(/(전주|군산|익산|정읍|남원|김제|완주|진안|무주|장수|임실|순창|고창|부안)(?:시|군)(?=\s|$)/g, "$1")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fareRouteWords(value) {
  return normalizedFareLocation(value)
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);
}

export function fareLocationMatchScore(left, right) {
  const leftNormalized = normalizedFareLocation(left);
  const rightNormalized = normalizedFareLocation(right);
  if (!leftNormalized || !rightNormalized) return 0;
  if (leftNormalized === rightNormalized) return 1_000 + leftNormalized.length;

  const leftWords = fareRouteWords(left);
  const rightWords = fareRouteWords(right);
  let best = 0;
  leftWords.forEach((leftWord) => {
    rightWords.forEach((rightWord) => {
      if (leftWord === rightWord) {
        best = Math.max(best, 200 + leftWord.length);
      } else if (leftWord.includes(rightWord) || rightWord.includes(leftWord)) {
        best = Math.max(best, 100 + Math.min(leftWord.length, rightWord.length));
      }
    });
  });
  return best;
}

function fareAmount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function farePairKey(preset) {
  return `${fareAmount(preset.outbound_fare ?? preset.outboundFare)}:${fareAmount(preset.return_fare ?? preset.returnFare)}`;
}

function rankCandidates(origin, destination, presets, { reverse = false } = {}) {
  return presets
    .map((preset) => {
      const presetOrigin = reverse ? preset.destination : preset.origin;
      const presetDestination = reverse ? preset.origin : preset.destination;
      const originScore = fareLocationMatchScore(origin, presetOrigin);
      const destinationScore = fareLocationMatchScore(destination, presetDestination);
      if (!originScore || !destinationScore) return null;
      return { preset, score: originScore + destinationScore };
    })
    .filter(Boolean)
    .sort((left, right) => (
      right.score - left.score
      || Number(right.preset.scope === "global") - Number(left.preset.scope === "global")
      || String(left.preset.origin).localeCompare(String(right.preset.origin), "ko-KR")
      || String(left.preset.destination).localeCompare(String(right.preset.destination), "ko-KR")
    ));
}

function reversedPreset(preset) {
  const outboundFare = fareAmount(preset.return_fare ?? preset.returnFare);
  const returnFare = fareAmount(preset.outbound_fare ?? preset.outboundFare);
  return {
    ...preset,
    origin: preset.destination,
    destination: preset.origin,
    outbound_fare: outboundFare,
    return_fare: returnFare,
    outboundFare,
    returnFare,
    matchDirection: "reverse",
    matchedSourceOrigin: preset.origin,
    matchedSourceDestination: preset.destination,
  };
}

function selectCandidate(candidates, { reverse = false } = {}) {
  if (!candidates.length) return { preset: null, ambiguous: false, candidates: [] };
  const topScore = candidates[0].score;
  const topCandidates = candidates.filter((candidate) => candidate.score === topScore);
  const resolvedPresets = topCandidates.map(({ preset }) => reverse ? reversedPreset(preset) : preset);
  const farePairs = new Set(resolvedPresets.map(farePairKey));

  // 같은 지역 단어에 여러 노선이 걸리고 금액까지 다르면 첫 행을 임의 적용하지 않는다.
  // 금액이 같은 중복 후보는 실제 지급액이 같으므로 공용 기준표·가나다순 우선으로 적용한다.
  if (topCandidates.length > 1 && farePairs.size > 1) {
    return { preset: null, ambiguous: true, candidates: resolvedPresets };
  }

  return {
    preset: resolvedPresets[0],
    ambiguous: topCandidates.length > 1,
    candidates: resolvedPresets,
  };
}

function findRouteMatch(trip, presets) {
  if (!["personal", "public"].includes(trip?.transportType) || trip?.tripScope === "local") {
    return { preset: null, ambiguous: false, candidates: [] };
  }

  const origin = String(trip?.origin || "").trim();
  const destination = String(trip?.destination || "").trim();
  if (!fareRouteWords(origin).length || !fareRouteWords(destination).length) {
    return { preset: null, ambiguous: false, candidates: [] };
  }

  // 정방향 후보가 하나라도 있으면 역방향 후보보다 항상 우선한다.
  const directCandidates = rankCandidates(origin, destination, presets);
  if (directCandidates.length) return selectCandidate(directCandidates);

  // 정방향 노선이 없을 때에만 도착지→출발지 노선을 뒤집어 왕복 금액도 교환한다.
  const reverseCandidates = rankCandidates(origin, destination, presets, { reverse: true });
  return selectCandidate(reverseCandidates, { reverse: true });
}

function faresOnDate(presets, date) {
  const latestDates = new Map();
  const routeKey = (preset) => JSON.stringify([normalizedFareLocation(preset.origin), normalizedFareLocation(preset.destination)]);
  for (const preset of presets) {
    const effective = fareEffectiveDate(preset);
    if (effective > date || (preset.effective_until && date >= preset.effective_until)) continue;
    const key = routeKey(preset);
    if (!latestDates.has(key) || latestDates.get(key) < effective) latestDates.set(key, effective);
  }
  return presets.filter((preset) => latestDates.get(routeKey(preset)) === fareEffectiveDate(preset)
    && (!preset.effective_until || date < preset.effective_until));
}

export function findAutomaticFareMatch(trip, presets = []) {
  const dated = presets.some((preset) => preset.effective_from || preset.effectiveFrom);
  if (!dated) return findRouteMatch(trip, presets);
  const outboundDate = fareDate(trip?.startAt);
  const returnDate = fareDate(trip?.endAt);
  if (!outboundDate || !returnDate || returnDate < outboundDate) {
    return { preset: null, ambiguous: false, candidates: [], missingDate: true };
  }
  const outbound = findRouteMatch(trip, faresOnDate(presets, outboundDate));
  const returning = findRouteMatch(trip, faresOnDate(presets, returnDate));
  if (!outbound.preset || !returning.preset) {
    return { preset: null, ambiguous: outbound.ambiguous || returning.ambiguous, candidates: [...outbound.candidates, ...returning.candidates], unavailableDate: findRouteMatch(trip, presets).candidates.length > 0 };
  }
  return {
    ...outbound,
    preset: {
      ...outbound.preset,
      return_fare: returning.preset.return_fare ?? returning.preset.returnFare,
      returnFare: returning.preset.return_fare ?? returning.preset.returnFare,
      outboundEffectiveFrom: fareEffectiveDate(outbound.preset),
      returnEffectiveFrom: fareEffectiveDate(returning.preset),
      outboundTravelDate: outboundDate,
      returnTravelDate: returnDate,
    },
  };
}
