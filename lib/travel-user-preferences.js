import { ORGANIZATION_CONFIG } from "../config/organization.js";

export const TRAVEL_USER_PREFERENCES_TABLE = "travel_user_preferences";

function cleanOrigin(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function allowedOriginPreference(value, originBases = ORGANIZATION_CONFIG.originBases) {
  const cleaned = cleanOrigin(value);
  return originBases.find((origin) => cleanOrigin(origin) === cleaned) || "";
}

export function originPreferenceValidationError(value, originBases = ORGANIZATION_CONFIG.originBases) {
  if (!cleanOrigin(value)) return "기본 출발 사무소를 선택해 주세요.";
  if (!allowedOriginPreference(value, originBases)) return "운영 중인 사무소 목록에서 출발 기준지를 선택해 주세요.";
  return "";
}

export function initialTripOrigin(value, originBases = ORGANIZATION_CONFIG.originBases) {
  return allowedOriginPreference(value, originBases) || (originBases.length === 1 ? originBases[0] : "");
}

export async function loadTravelUserPreference(client, userId) {
  if (!client || !userId) return { defaultOrigin: "", error: null };
  const { data, error } = await client
    .from(TRAVEL_USER_PREFERENCES_TABLE)
    .select("default_origin")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { defaultOrigin: "", error };
  return {
    defaultOrigin: allowedOriginPreference(data?.default_origin),
    error: null,
  };
}
