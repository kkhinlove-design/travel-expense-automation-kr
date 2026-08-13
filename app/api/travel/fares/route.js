import { NextResponse } from "next/server";
import { findTagoFareOptions } from "@/lib/tago-fares";
import { getSupabaseUser } from "@/lib/supabase/server";

const MAX_PLACE_LENGTH = 120;

export async function GET(request) {
  // 이 라우트는 기관의 공공데이터 인증키로 외부 API를 대신 호출한다.
  // 로그인 검사가 없으면 누구나 기관 몫의 일일 호출 한도를 소진시킬 수 있다.
  const { user } = await getSupabaseUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const origin = (params.get("origin") || "").trim();
  const destination = (params.get("destination") || "").trim();
  const date = params.get("date") || "";
  if (!origin || !destination || !date) return NextResponse.json({ error: "출발지, 도착지, 조회일을 입력해 주세요." }, { status: 400 });
  if (origin.length > MAX_PLACE_LENGTH || destination.length > MAX_PLACE_LENGTH) {
    return NextResponse.json({ error: "출발지와 도착지는 120자 이하로 입력해 주세요." }, { status: 400 });
  }
  try { return NextResponse.json(await findTagoFareOptions({ serviceKey: process.env.DATA_GO_KR_SERVICE_KEY, origin, destination, date })); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "교통 운임을 조회하지 못했습니다." }, { status: 502 }); }
}
