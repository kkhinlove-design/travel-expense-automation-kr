import { redirect } from "next/navigation";
import { getSupabaseUser } from "@/lib/supabase/server";

const SIGN_IN_PATH = "/signin";
const SIGN_OUT_PATH = "/auth/signout";
const CALLBACK_PATH = "/auth/callback";

function supabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
      && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

function localDevelopmentUserEnabled() {
  return process.env.NODE_ENV === "development"
    && process.env.ALLOW_LOCAL_DEV_USER === "true";
}

export async function getAuthenticatedUser() {
  if (!supabaseConfigured()) return null;
  const { user } = await getSupabaseUser();
  if (!user) return null;

  const fullName = user.user_metadata?.full_name || null;
  return {
    userId: user.id,
    displayName: fullName || user.email,
    email: user.email,
    fullName,
    appMetadata: user.app_metadata ?? {},
  };
}

export async function requireAuthenticatedUser(returnTo) {
  const user = await getAuthenticatedUser();
  if (user) return user;

  if (localDevelopmentUserEnabled()) {
    return {
      userId: "local-development-user",
      displayName: "로컬 테스트 사용자",
      email: "local@example.test",
      fullName: "로컬 테스트 사용자",
      appMetadata: {},
    };
  }

  redirect(signInPath(returnTo));
}

export function signInPath(returnTo = "/") {
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function signOutPath(returnTo = "/") {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  if (localDevelopmentUserEnabled() && !supabaseConfigured()) {
    return signInPath(safeReturnTo);
  }
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";

  let url;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname) {
  return pathname === SIGN_IN_PATH || pathname === SIGN_OUT_PATH || pathname === CALLBACK_PATH;
}
