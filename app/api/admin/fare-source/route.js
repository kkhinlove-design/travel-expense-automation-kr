import { NextResponse } from "next/server";
import { hasAdminUiAccess } from "@/config/admin";
import { parseGoogleFareSourceCsv } from "@/lib/google-fare-source";
import { getSupabaseUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DEFAULT_SPREADSHEET_ID = "1mnIzfAF1_T0lbzec93VZ0KYmDWJJM2EnG_3S5OYe6A4";
const DEFAULT_SHEET_GID = "2004325275";
const MAX_CSV_BYTES = 2 * 1024 * 1024;

function sourceConfig() {
  const spreadsheetId = String(process.env.FARE_SOURCE_GOOGLE_SHEET_ID || DEFAULT_SPREADSHEET_ID).trim();
  const gid = String(process.env.FARE_SOURCE_GOOGLE_SHEET_GID || DEFAULT_SHEET_GID).trim();
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(spreadsheetId) || !/^\d+$/.test(gid)) {
    throw new Error("fare_source_config_invalid");
  }
  return {
    spreadsheetId,
    gid,
    csvUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`,
    publicUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}`,
  };
}

export async function GET() {
  const { user } = await getSupabaseUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasAdminUiAccess(user)) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  try {
    const config = sourceConfig();
    const response = await fetch(config.csvUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "text/csv,text/plain;q=0.9" },
    });
    if (!response.ok) throw new Error("fare_source_fetch_failed");
    const csvText = await response.text();
    if (new TextEncoder().encode(csvText).byteLength > MAX_CSV_BYTES) throw new Error("fare_source_too_large");
    const parsed = parseGoogleFareSourceCsv(csvText);
    return NextResponse.json({
      ...parsed,
      sourceName: "Google 시트 · 운임 조사",
      sourceUrl: config.publicUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const errors = {
      fare_source_config_invalid: "Google 운임 시트 설정이 올바르지 않습니다.",
      fare_source_fetch_failed: "Google 운임 시트를 불러오지 못했습니다. 링크 공개 상태를 확인해 주세요.",
      fare_source_too_large: "Google 운임 시트가 허용 크기를 넘었습니다.",
    };
    return NextResponse.json({ error: errors[message] || message || "Google 운임 시트를 처리하지 못했습니다." }, { status: 502 });
  }
}
