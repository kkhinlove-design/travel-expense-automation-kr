const TAGO_SERVICES = [
  {
    id: "intercity",
    label: "시외버스",
    baseUrl: "https://apis.data.go.kr/1613000/SuburbsBusInfo",
    cityPath: "GetCtyCodeList",
    placePath: "GetSuberbsBusTrminlList",
    routePath: "GetStrtpntAlocFndSuberbsBusInfo",
    placeIdKeys: ["terminalId", "nodeid"],
    placeNameKeys: ["terminalNm", "nodename"],
  },
  {
    id: "express",
    label: "고속버스",
    baseUrl: "https://apis.data.go.kr/1613000/ExpBusInfo",
    cityPath: "GetCtyCodeList",
    placePath: "GetExpBusTrminlList",
    routePath: "GetStrtpntAlocFndExpbusInfo",
    placeIdKeys: ["terminalId", "nodeid"],
    placeNameKeys: ["terminalNm", "nodename"],
    globalPlaceList: true,
  },
  {
    id: "train",
    label: "열차",
    baseUrl: "https://apis.data.go.kr/1613000/TrainInfo",
    cityPath: "GetCtyCodeList",
    placePath: "GetCtyAcctoTrainSttnList",
    routePath: "GetStrtpntAlocFndTrainInfo",
    placeIdKeys: ["nodeid", "terminalId"],
    placeNameKeys: ["nodename", "terminalNm"],
  },
];

const memoryCache = new Map();

function firstValue(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function tagoItems(payload) {
  const item = payload?.response?.body?.items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\([^)]*\)/g, " ")
    .replace(/(대한민국|특별자치도|특별자치시|광역시|특별시|사업단|출장소|본사)/g, " ")
    .replace(/[^0-9A-Za-z가-힣]/g, "")
    .toLowerCase();
}

function placeScore(query, place) {
  const source = normalizedText(query);
  const name = normalizedText(place.name);
  if (!source || !name) return 0;
  if (source === name) return 120;
  if (source.includes(name)) return 100 - Math.min(source.length - name.length, 25);
  if (name.includes(source)) return 85 - Math.min(name.length - source.length, 25);
  const tokens = String(query).match(/[가-힣]{2,}/g) ?? [];
  return tokens.some((token) => name.includes(normalizedText(token))) ? 45 : 0;
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

async function cachedJson(key, ttlSeconds, loader) {
  const now = Date.now();
  const memory = memoryCache.get(key);
  if (memory && memory.expiresAt > now) return memory.value;

  const edgeCache = typeof caches !== "undefined" ? caches.default : null;
  const cacheRequest = new Request(`https://travel-cache.invalid/tago/${encodeURIComponent(key)}`);
  if (edgeCache) {
    const cached = await edgeCache.match(cacheRequest);
    if (cached) {
      const value = await cached.json();
      memoryCache.set(key, { value, expiresAt: now + ttlSeconds * 1_000 });
      return value;
    }
  }

  const value = await loader();
  memoryCache.set(key, { value, expiresAt: now + ttlSeconds * 1_000 });
  if (edgeCache) {
    await edgeCache.put(cacheRequest, Response.json(value, {
      headers: { "cache-control": `public, max-age=${ttlSeconds}` },
    }));
  }
  return value;
}

async function fetchTago(service, path, serviceKey, params = {}) {
  const url = new URL(`${service.baseUrl}/${path}`);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("_type", "json");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", String(params.numOfRows ?? 100));
  Object.entries(params).forEach(([key, value]) => {
    if (key !== "numOfRows" && value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${service.label} API HTTP ${response.status}`);
    const payload = await response.json();
    const code = String(payload?.response?.header?.resultCode ?? "");
    if (code && code !== "00") throw new Error(`${service.label} API 오류 ${code}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePlaces(service, items) {
  const seen = new Set();
  return items.flatMap((item) => {
    const id = String(firstValue(item, service.placeIdKeys) ?? "");
    const name = String(firstValue(item, service.placeNameKeys) ?? "");
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name, city: String(firstValue(item, ["cityName", "cityname"]) ?? "") }];
  });
}

async function servicePlaces(service, serviceKey) {
  return cachedJson(`catalog-${service.id}-v2`, 21_600, async () => {
    if (service.globalPlaceList) {
      const payload = await fetchTago(service, service.placePath, serviceKey, { numOfRows: 1000 });
      return normalizePlaces(service, tagoItems(payload));
    }

    const citiesPayload = await fetchTago(service, service.cityPath, serviceKey, { numOfRows: 100 });
    const cities = tagoItems(citiesPayload)
      .map((item) => String(firstValue(item, ["cityCode", "citycode"]) ?? ""))
      .filter(Boolean);
    const pages = await mapLimit(cities, 4, async (cityCode) => {
      try {
        const payload = await fetchTago(service, service.placePath, serviceKey, { cityCode, numOfRows: 500 });
        return tagoItems(payload);
      } catch {
        return [];
      }
    });
    return normalizePlaces(service, pages.flat());
  });
}

function matchPlaces(query, places) {
  return places
    .map((place) => ({ ...place, score: placeScore(query, place) }))
    .filter((place) => place.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ko"))
    .slice(0, 2);
}

function formatPlandTime(value) {
  const digits = String(value ?? "").replace(/\D/g, "").padEnd(12, "0");
  if (digits.length < 12) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}`;
}

function normalizeRoute(service, item, origin, destination) {
  const oneWayFare = Math.round(Number(firstValue(item, ["adultcharge", "adultCharge", "charge", "fare"]) ?? 0));
  if (!oneWayFare) return null;
  return {
    id: `${service.id}-${firstValue(item, ["routeId", "trainno"]) ?? "route"}-${firstValue(item, ["depplandtime", "depPlandTime"]) ?? ""}-${oneWayFare}`,
    mode: service.id,
    provider: service.label,
    departure: String(firstValue(item, ["depplacename", "depPlaceNm"]) ?? origin.name),
    arrival: String(firstValue(item, ["arrplacename", "arrPlaceNm"]) ?? destination.name),
    departureTime: formatPlandTime(firstValue(item, ["depplandtime", "depPlandTime"])),
    arrivalTime: formatPlandTime(firstValue(item, ["arrplandtime", "arrPlandTime"])),
    grade: String(firstValue(item, ["traingradename", "trainGradeName", "gradeNm", "gradeName"]) ?? "일반"),
    oneWayFare,
    roundTripFare: oneWayFare * 2,
  };
}

function optionRank(option) {
  const serviceRank = option.mode === "intercity" ? 0 : option.mode === "express" ? 1 : 2;
  const grade = option.grade;
  const gradeRank = /우등/.test(grade) && !/심야|프리미엄/.test(grade) ? 0 : /우등/.test(grade) ? 1 : 2;
  return serviceRank * 1_000_000 + gradeRank * 100_000 + option.oneWayFare;
}

async function serviceFareOptions(service, serviceKey, originQuery, destinationQuery, date) {
  const places = await servicePlaces(service, serviceKey);
  const origins = matchPlaces(originQuery, places);
  const destinations = matchPlaces(destinationQuery, places);
  if (!origins.length || !destinations.length) return [];

  const pairs = origins.flatMap((origin) => destinations
    .filter((destination) => destination.id !== origin.id)
    .map((destination) => ({ origin, destination })));
  const dateValue = String(date).replace(/\D/g, "").slice(0, 8);
  const results = await mapLimit(pairs, 3, async ({ origin, destination }) => {
    const idParams = service.id === "train"
      ? { depPlaceId: origin.id, arrPlaceId: destination.id }
      : { depTerminalId: origin.id, arrTerminalId: destination.id };
    const cacheKey = `route-${service.id}-${origin.id}-${destination.id}-${dateValue}`;
    try {
      const payload = await cachedJson(cacheKey, 3_600, () => fetchTago(service, service.routePath, serviceKey, {
        ...idParams,
        depPlandTime: dateValue,
        numOfRows: 100,
      }));
      return tagoItems(payload)
        .map((item) => normalizeRoute(service, item, origin, destination))
        .filter(Boolean);
    } catch {
      return [];
    }
  });
  return results.flat();
}

export async function findTagoFareOptions({ serviceKey, origin, destination, date }) {
  if (!serviceKey) throw new Error("공공데이터 인증키가 설정되지 않았습니다.");
  if (!origin || !destination || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw new Error("출발지, 도착지, 출장일을 확인해 주세요.");
  }

  const settled = await Promise.allSettled(TAGO_SERVICES.map((service) =>
    serviceFareOptions(service, serviceKey, origin, destination, date)));
  const options = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const deduped = [...new Map(options.map((option) => [
    `${option.mode}|${option.departure}|${option.arrival}|${option.departureTime}|${option.grade}|${option.oneWayFare}`,
    option,
  ])).values()]
    .sort((a, b) => optionRank(a) - optionRank(b))
    .slice(0, 18);

  const recommendedIndex = deduped.findIndex((option) =>
    ["intercity", "express"].includes(option.mode) && /우등/.test(option.grade) && !/심야|프리미엄/.test(option.grade));
  const fallbackIndex = deduped.findIndex((option) => ["intercity", "express"].includes(option.mode));
  const selectedIndex = recommendedIndex >= 0 ? recommendedIndex : fallbackIndex >= 0 ? fallbackIndex : (deduped.length ? 0 : -1);

  return {
    options: deduped.map((option, index) => ({ ...option, recommended: index === selectedIndex })),
    partialFailure: settled.some((result) => result.status === "rejected"),
  };
}
