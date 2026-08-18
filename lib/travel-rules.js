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

export function fareGradeForDocument(value) {
  const grade = String(value ?? "").replace(/\s+/g, " ").trim();
  if (/^(인정|수동)\s*운임$/.test(grade)) return "";
  return grade || "-";
}

const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const OFFSET_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

function validCalendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

// datetime-local 값은 브라우저 시간대로 읽되, JS Date가 2월 30일 같은 값을
// 다음 달로 자동 보정하지 못하도록 구성 요소를 한 번 더 대조한다. 이미 저장된
// ISO 시각(Z/offset)도 받을 수 있게 별도 경로를 둔다.
function tripDateTime(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const local = text.match(LOCAL_DATE_TIME_PATTERN);
  if (local) {
    const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", millisecondText = "0"] = local;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const millisecond = Number(millisecondText.padEnd(3, "0"));
    if (!validCalendarDate(year, month, day)
      || hour > 23
      || minute > 59
      || second > 59
      || millisecond > 999) return null;
    const date = new Date(year, month - 1, day, hour, minute, second, millisecond);
    return {
      timestamp: date.getTime(),
      calendarDay: Date.UTC(year, month - 1, day),
    };
  }

  const offset = text.match(OFFSET_DATE_TIME_PATTERN);
  if (!offset) return null;
  const year = Number(offset[1]);
  const month = Number(offset[2]);
  const day = Number(offset[3]);
  if (!validCalendarDate(year, month, day)) return null;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return null;
  return { timestamp, calendarDay: Date.UTC(year, month - 1, day) };
}

export function tripDateValidationError(startAt, endAt) {
  const startText = String(startAt ?? "").trim();
  const endText = String(endAt ?? "").trim();
  if (!startText || !endText) return "출장 시작 일시와 종료 일시를 모두 입력해 주세요.";

  const start = tripDateTime(startText);
  const end = tripDateTime(endText);
  if (!start || !end) return "출장 시작 일시 또는 종료 일시 형식이 올바르지 않습니다.";
  if (end.timestamp <= start.timestamp || end.calendarDay < start.calendarDay) {
    return "출장 종료 일시는 시작 일시보다 늦어야 합니다.";
  }
  return "";
}

function requiredText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function tripRequiredInformationValidationError(trip) {
  if (!requiredText(trip?.purpose)) return "출장 목적을 입력해 주세요.";
  if (!requiredText(trip?.destination)) return "출장지(방문기관)를 입력해 주세요.";

  const participants = Array.isArray(trip?.participants) && trip.participants.length
    ? trip.participants
    : [{ department: trip?.department, position: trip?.position, employeeName: trip?.employeeName }];
  for (let index = 0; index < participants.length; index += 1) {
    const participant = participants[index] || {};
    const who = requiredText(participant.employeeName) || `${index + 1}번째 출장자`;
    if (!requiredText(participant.department)) return `${who}의 부서를 입력해 주세요.`;
    if (!requiredText(participant.position)) return `${who}의 직급/직위를 입력해 주세요.`;
    if (!requiredText(participant.employeeName)) return `${index + 1}번째 출장자의 성명을 입력해 주세요.`;
  }
  return "";
}

export function tripDayCount(startAt, endAt) {
  if (tripDateValidationError(startAt, endAt)) return 0;
  const start = tripDateTime(startAt);
  const end = tripDateTime(endAt);
  return Math.floor((end.calendarDay - start.calendarDay) / 86_400_000) + 1;
}

export function tripNightCount(startAt, endAt) {
  return Math.max(0, tripDayCount(startAt, endAt) - 1);
}

export function tripDurationHours(startAt, endAt) {
  if (tripDateValidationError(startAt, endAt)) return 0;
  const start = tripDateTime(startAt);
  const end = tripDateTime(endAt);
  return (end.timestamp - start.timestamp) / 3_600_000;
}

export const MAX_WON = 10_000_000;

// 금액 칸이 비어 있는 것과 숫자로 읽히지 않는 것은 다르다. 아래 검사는 그 차이를
// 구분해서, 값을 조용히 0으로 만들고 지나가는 일이 없도록 사유를 함께 돌려준다.
export function wonAmount(value) {
  if (value === undefined || value === null || value === "") return { won: 0, issue: null };
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return { won: 0, issue: "notNumeric" };
  const rounded = Math.round(numeric);
  if (rounded < 0) return { won: 0, issue: "negative" };
  if (rounded > MAX_WON) return { won: MAX_WON, issue: "capped" };
  return { won: rounded, issue: null };
}

function roundWon(value) {
  return wonAmount(value).won;
}

function amountIssueText(label, value, issue) {
  if (issue === "notNumeric") {
    return `${label}을(를) 금액으로 읽지 못해 0원으로 계산했습니다. 입력값 "${String(value).slice(0, 40)}"에서 쉼표나 단위를 빼고 숫자만 넣어 주세요.`;
  }
  if (issue === "negative") {
    return `${label}에 음수가 들어와 0원으로 계산했습니다. 입력값을 확인해 주세요.`;
  }
  if (issue === "capped") {
    return `${label}이(가) 상한 ${MAX_WON.toLocaleString("ko-KR")}원을 넘어 상한값으로 계산했습니다. 실제 금액을 확인해 주세요.`;
  }
  return "";
}

/**
 * 계산에 들어간 금액 중 그대로 쓰이지 못하고 0원이나 상한값으로 바뀐 항목을 찾는다.
 * 사용자가 결과를 확정하기 전에 반드시 보이도록 경고 문구로 돌려준다.
 */
export function tripAmountIssues(trip) {
  const issues = [];
  const check = (label, value) => {
    const { issue } = wonAmount(value);
    if (issue) issues.push(amountIssueText(label, value, issue));
  };

  if (trip?.outboundTransportActual !== undefined || trip?.returnTransportActual !== undefined) {
    check("가는 길 운임", trip.outboundTransportActual);
    check("오는 길 운임", trip.returnTransportActual);
  } else {
    check("교통비", trip?.transportActual);
  }

  const participants = Array.isArray(trip?.participants) && trip.participants.length
    ? trip.participants
    : [{ employeeName: trip?.employeeName, lodgingActual: trip?.lodgingActual, deduction: trip?.deduction }];
  participants.forEach((participant, index) => {
    const who = String(participant?.employeeName || "").trim() || `${index + 1}번째 출장자`;
    // normalizeTripParticipants와 같은 순서로 값을 고른다. 첫 출장자는 개인 값이
    // 없으면 출장 단위 값을 물려받으므로 그쪽까지 함께 본다.
    const lodging = participant?.lodgingActual ?? (index === 0 ? trip?.lodgingActual : undefined);
    const deduction = participant?.deduction ?? (index === 0 ? trip?.deduction : undefined);
    check(`${who}의 숙박 실제 소요액`, lodging);
    check(`${who}의 기타 감액`, deduction);
  });

  return issues;
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
  if (!origin || !destination) return "근무지외 출장은 출발 기준지와 교통 도착지를 모두 선택·입력해 주세요.";
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
  const { days, nights, scheduleValid } = common;
  if (!scheduleValid) {
    return {
      participant,
      days: 0,
      nights: 0,
      transport: 0,
      perDiem: 0,
      lodging: 0,
      meal: 0,
      deduction: 0,
      total: 0,
    };
  }
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
  const dateError = tripDateValidationError(trip.startAt, trip.endAt);
  const days = tripDayCount(trip.startAt, trip.endAt);
  const nights = tripNightCount(trip.startAt, trip.endAt);
  const participants = normalizeTripParticipants(trip);
  // 금액으로 읽지 못한 값은 무엇보다 먼저 알린다. 이 경고가 붙은 결과는
  // 그대로 지급액으로 확정하면 안 된다.
  const warnings = tripAmountIssues(trip);
  if (dateError) warnings.unshift(`${dateError} 일시를 확인하기 전에는 여비를 계산하지 않습니다.`);

  if (!dateError && trip.tripScope !== "local") {
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

  const participantExpenses = participants.map((participant) => participantExpense(trip, participant, {
    days,
    nights,
    scheduleValid: !dateError,
  }, policy));
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
  const ruleSummary = dateError
    ? "출장 일시 확인 필요"
    : trip.tripScope === "local"
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
