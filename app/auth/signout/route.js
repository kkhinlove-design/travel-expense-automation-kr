import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRelativeReturnPath } from "@/lib/safe-return-path";

export async function GET(request) {
  const client = await createSupabaseServerClient();
  await client.auth.signOut();
  const target = safeRelativeReturnPath(new URL(request.url).searchParams.get("return_to"));
  return NextResponse.redirect(new URL(target, request.url));
}
