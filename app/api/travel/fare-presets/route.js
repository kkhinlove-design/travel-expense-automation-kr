import { NextResponse } from "next/server";
import { getSupabaseUser } from "@/lib/supabase/server";

function clean(value, max = 120) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max); }
function fare(value) { const n = Number(value); return Number.isSafeInteger(n) && n >= 0 && n <= 10000000 ? n : null; }
function normalize(input = {}) { return { id: clean(input.id, 80), origin: clean(input.origin), destination: clean(input.destination), outboundFare: fare(input.outboundFare ?? input.outbound_fare), returnFare: fare(input.returnFare ?? input.return_fare) }; }
function invalid(p, row = "") {
  if (!p.origin || !p.destination) return `${row}출발지와 도착지를 모두 입력해 주세요.`;
  if (p.origin === p.destination) return `${row}출발지와 도착지는 서로 달라야 합니다.`;
  if (p.outboundFare === null || p.returnFare === null) return `${row}운임은 0원 이상 1,000만원 이하의 정수로 입력해 주세요.`;
  if (!p.outboundFare && !p.returnFare) return `${row}가는 길 또는 오는 길 운임을 입력해 주세요.`;
  return null;
}
function output(row, scope = "personal") { return { id: row.id, origin: row.origin, destination: row.destination, outbound_fare: row.outbound_fare, return_fare: row.return_fare, updated_at: row.updated_at, scope }; }
function routeKey(origin, destination) { return `${String(origin || "").toLocaleLowerCase("ko-KR")}\u0000${String(destination || "").toLocaleLowerCase("ko-KR")}`; }

export async function GET() {
  const { client, user } = await getSupabaseUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const [{ data: globalData, error: globalError }, { data: personalData, error: personalError }] = await Promise.all([
    client.from("travel_fare_catalog").select("id,origin,destination,outbound_fare,return_fare,updated_at").order("origin", { ascending: true }).limit(500),
    client.from("travel_fare_presets").select("id,origin,destination,outbound_fare,return_fare,updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(100),
  ]);
  if (globalError || personalError) return NextResponse.json({ error: "공용 또는 개인 운임 설정을 불러오지 못했습니다." }, { status: 500 });
  const globalKeys = new Set((globalData || []).map((row) => routeKey(row.origin, row.destination)));
  const globalPresets = (globalData || []).map((row) => output({ ...row, id: `global-${row.id}` }, "global"));
  const personalPresets = (personalData || []).filter((row) => !globalKeys.has(routeKey(row.origin, row.destination))).map((row) => output(row, "personal"));
  return NextResponse.json({ presets: [...globalPresets, ...personalPresets], globalCount: globalPresets.length, personalCount: personalPresets.length });
}

export async function POST(request) {
  const { client, user } = await getSupabaseUser(); if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  let body; try { body = await request.json(); } catch { return NextResponse.json({ error: "대중교통 운임 형식이 올바르지 않습니다." }, { status: 400 }); }
  const inputs = Array.isArray(body.presets) ? body.presets : [body];
  if (!inputs.length || inputs.length > 100) return NextResponse.json({ error: "한 번에 1개 이상 100개 이하의 노선을 올려 주세요." }, { status: 400 });
  const presets = inputs.map(normalize);
  for (let i = 0; i < presets.length; i += 1) { const error = invalid(presets[i], inputs.length > 1 ? `${i + 1}행: ` : ""); if (error) return NextResponse.json({ error }, { status: 400 }); }
  const { data: existing, error: listError } = await client.from("travel_fare_presets").select("id,origin,destination,created_at").order("updated_at", { ascending: false }).limit(100);
  if (listError) return NextResponse.json({ error: "기존 운임 설정을 확인하지 못했습니다." }, { status: 500 });
  const byRoute = new Map((existing || []).map((row) => [`${row.origin.toLocaleLowerCase("ko-KR")}\u0000${row.destination.toLocaleLowerCase("ko-KR")}`, row]));
  const rows = presets.map((p) => { const old = byRoute.get(`${p.origin.toLocaleLowerCase("ko-KR")}\u0000${p.destination.toLocaleLowerCase("ko-KR")}`); return { id: old?.id || crypto.randomUUID(), user_id: user.id, origin: p.origin, destination: p.destination, outbound_fare: p.outboundFare, return_fare: p.returnFare, created_at: old?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() }; });
  const created = rows.filter((row) => !byRoute.has(`${row.origin.toLocaleLowerCase("ko-KR")}\u0000${row.destination.toLocaleLowerCase("ko-KR")}`)).length;
  if ((existing?.length || 0) + created > 100) return NextResponse.json({ error: "대중교통 운임 설정은 계정당 최대 100개까지 저장할 수 있습니다." }, { status: 400 });
  const { data, error } = await client.from("travel_fare_presets").upsert(rows, { onConflict: "id" }).select("id,origin,destination,outbound_fare,return_fare,updated_at");
  if (error) return NextResponse.json({ error: "대중교통 운임을 저장하지 못했습니다." }, { status: 500 });
  return NextResponse.json(Array.isArray(body.presets) ? { presets: data || [], created, updated: rows.length - created } : { preset: output(data?.[0] || rows[0]) });
}

export async function DELETE(request) {
  const { client, user } = await getSupabaseUser(); if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id"); if (!id) return NextResponse.json({ error: "삭제할 운임 ID가 없습니다." }, { status: 400 });
  const { error } = await client.from("travel_fare_presets").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "대중교통 운임을 삭제하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ deletedId: id });
}
