import { LODGING_CAPS, TRAVEL_POLICY } from "../config/travel-policy.js";

export const TRANSPORT_TYPES = [
  { value: "corporate", label: "법인차" },
  { value: "personal", label: "개인차" },
  { value: "public", label: "대중교통" },
];

export const PROJECT_TYPES = [
  { value: "labor", label: "고용부 사업" },
  { value: "general", label: "일반 사업" },
];

export const LABOR_MEAL_REGIONS = [
  { value: "inProvince", label: `도내 출장 · 최대 2식 ${TRAVEL_POLICY.laborMealDailyCap.toLocaleString("ko-KR")}원` },
  { value: "outProvince", label: `도외 출장 · 최대 3식 ${TRAVEL_POLICY.generalMealDailyCap.toLocaleString("ko-KR")}원` },
];

export { LODGING_CAPS };
export const DEFAULT_POLICY = TRAVEL_POLICY;

function dateOnly(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function tripDayCount(startAt, endAt) {
  const start = dateOnly(startAt);
  const end = dateOnly(endAt);
  if (!start || !end || end < start) return 1;
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function tripNightCount(startAt, endAt) {
  return Math.max(0, tripDayCount(startAt, endAt) - 1);
}

export function tripDurationHours(startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;
  return (end - start) / 3_600_000;
}

function roundWon(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(10_000_000, Math.max(0, Math.round(numeric)));
}

export function normalizeTripWaypoints(trip) {
  return (Array.isArray(trip?.waypoints) ? trip.waypoints : [])
    .map((waypoint) => typeof waypoint === "string" ? waypoint : waypoint?.name)
    .map((name) => String(name ?? "").trim())
    .filter(Boolean);
}

export function tripRoutePoints(trip, direction = "outbound") {
  const origin = String(trip?.origin ?? "").replace(/\s+/g, " ").trim();
  const transportDestination = String(trip?.transportDestination ?? "").replace(/\s+/g, " ").trim();
  const visitDestination = String(trip?.destination ?? "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  const destination = transportDestination || visitDestination;
  const outbound = [origin, ...normalizeTripWaypoints(trip), destination].filter(Boolean);
  return direction === "return" ? [...outbound].reverse() : outbound;
}

export function tripRouteValidationError(trip) {
  if (trip?.tripScope === "local") return "";
  const origin = String(trip?.origin ?? "").replace(/\s+/g, " ").trim();
  const transportDestination = String(trip?.transportDestination ?? "").replace(/\s+/g, " ").trim();
  const visitDestination = String(trip?.destination ?? "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  const destination = transportDestination || visitDestination;
  if (!origin || !destination) return "근무지외 출장은 교통 출발지와 도착지를 모두 입력해 주세요.";
  if (origin === destination) return "교통 출발지와 도착지는 서로 달라야 합니다.";
  return "";
}

export function tripTransportFares(trip) {
  const hasDirectionalFares = trip?.outboundTransportActual !== undefined
    || trip?.returnTransportActual !== undefined;
  if (hasDirectionalFares) {
    const outboundInput = roundWon(trip.outboundTransportActual);
    const returnInput = roundWon(trip.returnTransportActual);
    // Automatic preset metadata is the last safe source if a UI update left
    // the directional input fields at zero. Manual zero edits still win because
    // updateDirectionalFare replaces that direction's source with zero.
    const outboundSource = roundWon(trip?.fareSources?.outbound?.oneWayFare ?? trip?.fareSource?.oneWayFare);
    const returnSource = roundWon(trip?.fareSources?.return?.oneWayFare);
    const outbound = outboundInput || outboundSource;
    const returning = returnInput || returnSource;
    return { outbound, return: returning, total: outbound + returning };
  }

  const total = roundWon(trip?.transportActual);
  const outbound = Math.floor(total / 2);
  return { outbound, return: total - outbound, total };
}

function defaultMeals(trip) {
  return {
    breakfast: Boolean(trip.mealsProvided?.breakfast),
    lunch: Boolean(trip.mealsProvided?.lunch),
    dinner: Boolean(trip.mealsProvided?.dinner),
  };
}

export function normalizeTripParticipants(trip) {
  const raw = Array.isArray(trip.participants) && trip.participants.length
    ? trip.participants
    : [{
        id: "primary",
        department: trip.department,
        position: trip.position,
        employeeName: trip.employeeName,
        transportClaimant: true,
        lodgingActual: trip.lodgingActual,
        deduction: trip.deduction,
        mealsProvided: trip.mealsProvided,
      }];

  let claimantFound = false;
  return raw.map((participant, index) => {
    const requestedClaimant = Boolean(participant.transportClaimant);
    const transportClaimant = requestedClaimant && !claimantFound;
    if (transportClaimant) claimantFound = true;
    return {
      id: participant.id || `participant-${index + 1}`,
      department: String(participant.department ?? (index === 0 ? trip.department : "")),
      position: String(participant.position ?? (index === 0 ? trip.position : "")),
      employeeName: String(participant.employeeName ?? (index === 0 ? trip.employeeName : "")),
      transportClaimant,
      lodgingActual: roundWon(participant.lodgingActual ?? (index === 0 ? trip.lodgingActual : 0)),
      deduction: roundWon(participant.deduction ?? (index === 0 ? trip.deduction : 0)),
      mealsProvided: {
        ...defaultMeals(trip),
        ...(participant.mealsProvided ?? {}),
      },
    };
  }).map((participant, index, participants) => ({
    ...participant,
    transportClaimant: claimantFound ? participant.transportClaimant : index === 0 && participants.length > 0,
  }));
}

function mealAllowancePerDay(trip, provided, policy) {
  const laborInProvince = trip.projectType === "labor" && trip.laborMealRegion !== "outProvince";
  if (laborInProvince) {
    const providedCount = ["lunch", "dinner"].filter((meal) => provided[meal]).length;
    return [policy.laborMealDailyCap, Math.round(policy.laborMealDailyCap / 2), 0][providedCount] ?? 0;
  }

  const providedCount = ["breakfast", "lunch", "dinner"].filter((meal) => provided[meal]).length;
  return [
    policy.generalMealDailyCap,
    policy.generalMealAfterOneProvided,
    policy.generalMealAfterTwoProvided,
    0,
  ][providedCount] ?? 0;
}

function externalPerDiem(trip, days, policy) {
  const vehicleRate = trip.transportType === "corporate"
    ? policy.corporateDailyRate
    : trip.transportType === "personal"
      ? policy.personalDailyRate
      : policy.publicDailyRate;

  if (!trip.workshopStay || days <= 2) return roundWon(days * policy.dailyAllowance * vehicleRate);
  const middleDayRate = Math.min(vehicleRate, policy.workshopMiddleDayRate);
  return roundWon(policy.dailyAllowance * ((2 * vehicleRate) + ((days - 2) * middleDayRate)));
}

function participantExpense(trip, participant, common, policy) {
  const { days, nights } = common;
  if (trip.tripScope === "local") {
    const hours = tripDurationHours(trip.startAt, trip.endAt);
    const corporate = trip.transportType === "corporate";
    const perDiem = hours >= 4
      ? corporate ? policy.localCorporateFourHoursOrMore : policy.localPersonalFourHoursOrMore
      : corporate ? policy.localCorporateUnderFourHours : policy.localPersonalUnderFourHours;
    return {
      participant,
      days,
      nights: 0,
      transport: 0,
      perDiem: roundWon(perDiem),
      lodging: 0,
      meal: 0,
      deduction: 0,
      total: roundWon(perDiem),
    };
  }

  const transport = participant.transportClaimant ? tripTransportFares(trip).total : 0;
  const perDiem = externalPerDiem(trip, days, policy);
  const lodgingCap = LODGING_CAPS[trip.lodgingRegion] ?? LODGING_CAPS.other;
  const lodging = Math.min(roundWon(participant.lodgingActual), nights * lodgingCap);
  const meal = roundWon(days * mealAllowancePerDay(trip, participant.mealsProvided, policy));
  const deduction = roundWon(participant.deduction);
  return {
    participant,
    days,
    nights,
    transport,
    perDiem,
    lodging,
    meal,
    deduction,
    total: Math.max(0, transport + perDiem + lodging + meal - deduction),
  };
}

export function calculateTripExpense(trip, policy = DEFAULT_POLICY) {
  const days = tripDayCount(trip.startAt, trip.endAt);
  const nights = tripNightCount(trip.startAt, trip.endAt);
  const participants = normalizeTripParticipants(trip);
  const warnings = [];

  if (trip.tripScope !== "local") {
    if (!tripTransportFares(trip).total) {
      if (trip.transportType === "corporate") warnings.push("법인차 통행료·주차비 영수증 금액을 입력하면 대표 수령자에게 반영됩니다.");
      else if (trip.transportType === "personal") warnings.push("개인차는 대중교통 기준 왕복 운임 또는 인정 실비를 입력해야 지급액이 확정됩니다.");
      else warnings.push("대중교통 실제 운임을 입력해야 지급액이 확정됩니다.");
    }
    const lodgingCap = LODGING_CAPS[trip.lodgingRegion] ?? LODGING_CAPS.other;
    participants.forEach((participant) => {
      if (participant.lodgingActual > nights * lodgingCap) {
        warnings.push(`${participant.employeeName || "출장자"}의 숙박비에 ${lodgingCap.toLocaleString("ko-KR")}원/박 상한을 적용했습니다.`);
      }
    });
    if (participants.length > 1) {
      const claimant = participants.find((participant) => participant.transportClaimant);
      warnings.push(`동반 출장 교통비는 ${claimant?.employeeName || "첫 번째 출장자"} 1명에게만 지급됩니다.`);
    }
  }

  const participantExpenses = participants.map((participant) => participantExpense(trip, participant, { days, nights }, policy));
  const aggregate = participantExpenses.reduce((total, item) => ({
    transport: total.transport + item.transport,
    perDiem: total.perDiem + item.perDiem,
    lodging: total.lodging + item.lodging,
    meal: total.meal + item.meal,
    deduction: total.deduction + item.deduction,
    total: total.total + item.total,
  }), { transport: 0, perDiem: 0, lodging: 0, meal: 0, deduction: 0, total: 0 });

  const hours = trip.tripScope === "local" ? tripDurationHours(trip.startAt, trip.endAt) : 0;
  const claimant = participants.find((participant) => participant.transportClaimant);
  const ratePercent = (rate) => `${Math.round(Number(rate) * 100)}%`;
  const ruleSummary = trip.tripScope === "local"
    ? `${hours >= 4 ? "관내 4시간 이상" : "관내 4시간 미만"} · ${trip.transportType === "corporate" ? "법인차" : "자차"}`
    : participants.length > 1
      ? `동행 ${participants.length}명 · 교통비 ${claimant?.employeeName || "대표자"} 지급`
      : trip.transportType === "corporate"
        ? `법인차 실비 + 일비 ${ratePercent(policy.corporateDailyRate)}`
        : trip.transportType === "personal"
          ? `개인차 인정 운임 + 일비 ${ratePercent(policy.personalDailyRate)}`
          : `대중교통 실비 + 일비 ${ratePercent(policy.publicDailyRate)}`;

  return {
    days,
    nights: trip.tripScope === "local" ? 0 : nights,
    ...aggregate,
    participantExpenses,
    warnings,
    ruleSummary,
  };
}
