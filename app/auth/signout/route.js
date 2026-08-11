import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request) {
  const client = await createSupabaseServerClient();
  await client.auth.signOut();
  const target = new URL(request.url).searchParams.get("return_to") || "/";
  return NextResponse.redirect(new URL(target.startsWith("/") ? target : "/", request.url));
}
