import { NextResponse } from "next/server";
import { getSupabaseUser } from "@/lib/supabase/server";
import {
  MAX_KORDOC_HWPX_FILE_SIZE,
  TravelHwpxKordocError,
  parseApprovedTravelHwpxWithKordoc,
} from "@/lib/travel-hwpx-kordoc.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function hwpxFile(value) {
  return value instanceof File && value.size > 0 ? value : null;
}

export async function POST(request) {
  const { user } = await getSupabaseUser();
  if (!user) return json({ error: "로그인이 필요합니다." }, 401);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "HWPX 업로드 형식이 올바르지 않습니다." }, 400);
  }
  const file = hwpxFile(form.get("file"));
  if (!file) return json({ error: "분석할 HWPX 파일을 선택해 주세요." }, 400);
  if (!String(file.name || "").toLowerCase().endsWith(".hwpx")) {
    return json({ error: "HWPX 파일만 분석할 수 있습니다." }, 400);
  }
  if (file.size > MAX_KORDOC_HWPX_FILE_SIZE) {
    return json({ error: "HWPX 파일은 4MB 이하만 읽을 수 있습니다." }, 413);
  }

  try {
    const parsed = await parseApprovedTravelHwpxWithKordoc(await file.arrayBuffer());
    return json({ parsed });
  } catch (error) {
    if (error instanceof TravelHwpxKordocError) {
      const status = error.code === "TRAVEL_TABLE_NOT_FOUND" ? 422 : 400;
      return json({ error: error.message, code: error.code }, status);
    }
    return json({ error: "HWPX 분석 중 오류가 발생했습니다." }, 500);
  }
}
