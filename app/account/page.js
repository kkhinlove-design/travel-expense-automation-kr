import AccountPasswordForm from "./account-password-form";
import { requireAuthenticatedUser, signOutPath } from "../auth";
import { ORGANIZATION_CONFIG } from "@/config/organization";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `내 계정 | ${ORGANIZATION_CONFIG.appName}`,
  description: `${ORGANIZATION_CONFIG.appName} 계정의 비밀번호를 변경합니다.`,
};

export default async function AccountPage() {
  const user = await requireAuthenticatedUser("/account");
  return <AccountPasswordForm user={{ displayName: user.displayName, email: user.email }} signOutPath={signOutPath("/account")} />;
}
