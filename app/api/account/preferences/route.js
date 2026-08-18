import { NextResponse } from "next/server";
import { getSupabaseUser } from "@/lib/supabase/server";
import {
  allowedOriginPreference,
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

  const defaultOrigin = allowedOriginPreference(body.defaultOrigin);
  const now = new Date().toISOString();
  const { data, error } = await client
    .from(TRAVEL_USER_PREFERENCES_TABLE)
    .upsert({
      user_id: user.id,
      default_origin: defaultOrigin,
      updated_at: now,
    }, { onConflict: "user_id" })
    .select("default_origin,updated_at")
    .single();

  if (error) return NextResponse.json({ error: "기본 출발 사무소를 저장하지 못했습니다." }, { status: 500 });
  return NextResponse.json({
    preference: {
      defaultOrigin: data.default_origin,
      updatedAt: data.updated_at,
    },
  });
}
