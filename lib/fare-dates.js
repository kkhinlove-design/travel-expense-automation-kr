// 기존 운임은 시작일이 없는 기준값으로 보존한다.
export const LEGACY_FARE_DATE = "0001-01-01";

export function fareDate(value) {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : "";
}

export function fareEffectiveDate(preset) {
  return fareDate(preset.effective_from ?? preset.effectiveFrom) || LEGACY_FARE_DATE;
}

export function isManualFareSource(source) {
  // 공용 기준표도 출장 날짜에 따라 달라지므로 직접 입력과 구분한다.
  if (source?.sourceType === "preset") return false;
  return /수동|직접 입력/.test(String(source?.provider || ""));
}

export function clearPresetFareForDateChange(trip) {
  const sources = [trip.fareSource, ...Object.values(trip.fareSources || {})].filter(Boolean);
  if (!sources.some((source) => !isManualFareSource(source))) return trip;
  return { ...trip, outboundTransportActual: 0, returnTransportActual: 0, transportActual: 0, fareSource: null, fareSources: {} };
}
