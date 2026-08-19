import { NextResponse } from "next/server";
import { getSupabaseUser } from "@/lib/supabase/server";
import {
  allowedApprovalTitlePreference,
  allowedOriginPreference,
  approvalLinePreferenceValidationError,
  originPreferenceValidationError,
  TRAVEL_USER_PREFERENCES_TABLE,
} from "@/lib/travel-user-preferences";

export async function PUT(request) {
  const { client, user } = await getSupabaseUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "환경 설정 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const validationError = originPreferenceValidationError(body?.defaultOrigin);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const approvalValidationError = approvalLinePreferenceValidationError(body?.reportApprovalLine);
  if (approvalValidationError) return NextResponse.json({ error: approvalValidationError }, { status: 400 });

  const defaultOrigin = allowedOriginPreference(body.defaultOrigin);
  const reportApprovalLine = body.reportApprovalLine.map((title) => allowedApprovalTitlePreference(title));
  const now = new Date().toISOString();
  const { data, error } = await client
    .from(TRAVEL_USER_PREFERENCES_TABLE)
    .upsert({
      user_id: user.id,
      default_origin: defaultOrigin,
      report_approver_first: reportApprovalLine[0],
      report_approver_second: reportApprovalLine[1],
      report_approval_configured_at: now,
      updated_at: now,
    }, { onConflict: "user_id" })
    .select("default_origin,report_approver_first,report_approver_second,updated_at")
    .single();

  if (error) return NextResponse.json({ error: "출장 환경 설정을 저장하지 못했습니다." }, { status: 500 });
  return NextResponse.json({
    preference: {
      defaultOrigin: data.default_origin,
      reportApprovalLine: [data.report_approver_first, data.report_approver_second],
      configured: true,
      updatedAt: data.updated_at,
    },
  });
}
