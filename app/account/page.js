import AccountPasswordForm from "./account-password-form";
import { requireAuthenticatedUser, signOutPath } from "../auth";
import { ORGANIZATION_CONFIG } from "@/config/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadTravelUserPreference } from "@/lib/travel-user-preferences";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `내 환경 설정 | ${ORGANIZATION_CONFIG.appName}`,
  description: `${ORGANIZATION_CONFIG.appName}의 출장 기본값과 계정 비밀번호를 관리합니다.`,
};

export default async function AccountPage() {
  const user = await requireAuthenticatedUser("/account");
  const localDevelopment = user.userId === "local-development-user";
  let preference = {
    defaultOrigin: ORGANIZATION_CONFIG.originBases.length === 1 ? ORGANIZATION_CONFIG.defaultOrigin : "",
    reportApprovalLine: [...ORGANIZATION_CONFIG.defaultReportApprovalLine],
    error: null,
  };
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
      reportApproverTitles={ORGANIZATION_CONFIG.reportApproverTitles}
      initialReportApprovalLine={preference.reportApprovalLine}
      preferenceWritable={!localDevelopment && !preference.error}
      preferenceLoadError={preference.error ? "저장된 출장 기본값을 불러오지 못했습니다. 새 값으로 덮어쓰지 않도록 저장을 잠시 막았습니다." : ""}
    />
  );
}
