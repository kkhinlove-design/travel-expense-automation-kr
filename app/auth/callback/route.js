import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnTo = url.searchParams.get("return_to") || "/travel";
  if (code) {
    const client = await createSupabaseServerClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL(`/signin?error=${encodeURIComponent("로그인 링크가 만료되었거나 이미 사용되었습니다.")}`, request.url));
  }
  return NextResponse.redirect(new URL(returnTo.startsWith("/") ? returnTo : "/travel", request.url));
}
