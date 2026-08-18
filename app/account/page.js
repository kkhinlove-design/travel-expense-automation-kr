import AccountPasswordForm from "./account-password-form";
import { requireAuthenticatedUser, signOutPath } from "../auth";
import { ORGANIZATION_CONFIG } from "@/config/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadTravelUserPreference } from "@/lib/travel-user-preferences";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `내 환경 설정 | ${ORGANIZATION_CONFIG.appName}`,
  description: `${ORGANIZATION_CONFIG.appName}의 기본 출발 사무소와 계정 비밀번호를 관리합니다.`,
};

export default async function AccountPage() {
  const user = await requireAuthenticatedUser("/account");
  const localDevelopment = user.userId === "local-development-user";
  let preference = { defaultOrigin: ORGANIZATION_CONFIG.originBases.length === 1 ? ORGANIZATION_CONFIG.defaultOrigin : "", error: null };
  if (!localDevelopment) {
    const client = await createSupabaseServerClient();
    preference = await loadTravelUserPreference(client, user.userId);
  }

  return (
    <AccountPasswordForm
      user={{ displayName: user.displayName, email: user.email }}
      signOutPath={signOutPath("/account")}
      originBases={ORGANIZATION_CONFIG.originBases}
      initialDefaultOrigin={preference.defaultOrigin}
      preferenceWritable={!localDevelopment}
      preferenceLoadError={preference.error ? "저장된 기본 출발 사무소를 불러오지 못했습니다." : ""}
    />
  );
}
