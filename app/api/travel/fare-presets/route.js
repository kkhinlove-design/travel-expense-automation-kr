import { NextResponse } from "next/server";
import { getSupabaseUser } from "@/lib/supabase/server";

function output(row) {
  return {
    id: `global-${row.id}`,
    origin: row.origin,
    destination: row.destination,
    outbound_fare: row.outbound_fare,
    return_fare: row.return_fare,
    updated_at: row.updated_at,
    scope: "global",
  };
}

export async function GET() {
  const { client, user } = await getSupabaseUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { data, error } = await client
    .from("travel_fare_catalog")
    .select("id,origin,destination,outbound_fare,return_fare,updated_at")
    .order("origin", { ascending: true })
    .limit(500);
  if (error) return NextResponse.json({ error: "관리자 운임 기준표를 불러오지 못했습니다." }, { status: 500 });
  const presets = (data || []).map(output);
  return NextResponse.json({ presets, globalCount: presets.length, personalCount: 0 });
}

function mutationDisabled() {
  return NextResponse.json(
    { error: "운임 기준표는 관리자 화면에서만 변경할 수 있습니다." },
    { status: 405, headers: { Allow: "GET" } },
  );
}

export const POST = mutationDisabled;
export const DELETE = mutationDisabled;
