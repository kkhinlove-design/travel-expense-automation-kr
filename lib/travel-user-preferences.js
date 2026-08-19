import { ORGANIZATION_CONFIG } from "../config/organization.js";

export const TRAVEL_USER_PREFERENCES_TABLE = "travel_user_preferences";

function cleanOrigin(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanApprovalTitle(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function allowedOriginPreference(value, originBases = ORGANIZATION_CONFIG.originBases) {
  const cleaned = cleanOrigin(value);
  return originBases.find((origin) => cleanOrigin(origin) === cleaned) || "";
}

export function originPreferenceValidationError(value, originBases = ORGANIZATION_CONFIG.originBases) {
  if (!cleanOrigin(value)) return "기본 출발 기준지를 선택해 주세요.";
  if (!allowedOriginPreference(value, originBases)) return "운영 중인 기준지 목록에서 선택해 주세요.";
  return "";
}

export function initialTripOrigin(value, originBases = ORGANIZATION_CONFIG.originBases) {
  return allowedOriginPreference(value, originBases) || (originBases.length === 1 ? originBases[0] : "");
}

export function allowedApprovalTitlePreference(value, titles = ORGANIZATION_CONFIG.reportApproverTitles) {
  const cleaned = cleanApprovalTitle(value);
  return titles.find((title) => cleanApprovalTitle(title) === cleaned) || "";
}

export function approvalLinePreferenceValidationError(value, titles = ORGANIZATION_CONFIG.reportApproverTitles) {
  const line = Array.isArray(value) ? value : [];
  if (line.length !== 2 || line.some((title) => !cleanApprovalTitle(title))) return "1차 결재자와 최종 결재자를 모두 선택해 주세요.";
  if (line.some((title) => !allowedApprovalTitlePreference(title, titles))) return "기관에서 사용하는 결재자 직위 중에서 선택해 주세요.";
  if (cleanApprovalTitle(line[0]) === cleanApprovalTitle(line[1])) return "1차 결재자와 최종 결재자는 서로 다르게 선택해 주세요.";
  return "";
}

export function initialReportApprovalLine(value, titles = ORGANIZATION_CONFIG.reportApproverTitles) {
  const line = Array.isArray(value) ? value : [];
  if (!approvalLinePreferenceValidationError(line, titles)) {
    return line.map((title) => allowedApprovalTitlePreference(title, titles));
  }
  const configuredDefault = ORGANIZATION_CONFIG.defaultReportApprovalLine
    .map((title) => allowedApprovalTitlePreference(title, titles))
    .filter(Boolean);
  return configuredDefault.length === 2 && configuredDefault[0] !== configuredDefault[1]
    ? configuredDefault
    : titles.slice(0, 2);
}

export function reportApprovalLineForDocument(value) {
  const line = Array.isArray(value)
    ? value.slice(0, 2).map(cleanApprovalTitle)
    : [];
  return line.length === 2
    && line.every((title) => title && title.length <= 40)
    && line[0] !== line[1]
    ? line
    : [...ORGANIZATION_CONFIG.defaultReportApprovalLine];
}

export function travelUserPreferenceConfigured(
  data,
  originBases = ORGANIZATION_CONFIG.originBases,
  titles = ORGANIZATION_CONFIG.reportApproverTitles,
) {
  if (!data?.report_approval_configured_at) return false;
  if (!allowedOriginPreference(data.default_origin, originBases)) return false;
  return !approvalLinePreferenceValidationError([
    data.report_approver_first,
    data.report_approver_second,
  ], titles);
}

export async function loadTravelUserPreference(client, userId) {
  if (!client || !userId) return { defaultOrigin: "", reportApprovalLine: [...ORGANIZATION_CONFIG.defaultReportApprovalLine], configured: false, error: null };
  const { data, error } = await client
    .from(TRAVEL_USER_PREFERENCES_TABLE)
    .select("default_origin,report_approver_first,report_approver_second,report_approval_configured_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { defaultOrigin: "", reportApprovalLine: [...ORGANIZATION_CONFIG.defaultReportApprovalLine], configured: false, error };
  const configured = travelUserPreferenceConfigured(data);
  return {
    defaultOrigin: allowedOriginPreference(data?.default_origin),
    reportApprovalLine: configured
      ? initialReportApprovalLine([
          data.report_approver_first,
          data.report_approver_second,
        ])
      : [...ORGANIZATION_CONFIG.defaultReportApprovalLine],
    configured,
    error: null,
  };
}
