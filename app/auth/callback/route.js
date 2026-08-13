import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRelativeReturnPath } from "@/lib/safe-return-path";

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // 비밀번호 재설정 메일은 `/signin?mode=reset`으로 되돌아와야 하므로
  // 이 경로에서만 인증 화면으로의 복귀를 허용한다.
  const returnTo = safeRelativeReturnPath(url.searchParams.get("return_to"), {
    fallback: "/travel",
    allowAuthPaths: true,
  });
  if (code) {
    const client = await createSupabaseServerClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    // 사용자에게 보일 문구는 코드로만 전달한다. 쿼리스트링에 담긴 임의 문장을
    // 그대로 화면에 띄우면 공격자가 로그인 화면에 안내문을 심을 수 있다.
    if (error) return NextResponse.redirect(new URL("/signin?error=link_expired", request.url));
  }
  return NextResponse.redirect(new URL(returnTo, request.url));
}
