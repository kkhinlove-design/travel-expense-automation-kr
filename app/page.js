import TravelWorkspace from "./travel/travel-workspace";
import { requireAuthenticatedUser, signOutPath } from "./auth";
import { ORGANIZATION_CONFIG } from "@/config/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadTravelUserPreference } from "@/lib/travel-user-preferences";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireAuthenticatedUser("/");
  let defaultOrigin = "";
  let defaultReportApprovalLine = [...ORGANIZATION_CONFIG.defaultReportApprovalLine];
  if (user.userId !== "local-development-user") {
    const client = await createSupabaseServerClient();
    const preference = await loadTravelUserPreference(client, user.userId);
    if (!preference.error && !preference.configured) redirect("/account?setup=1&return_to=%2Ftravel");
    defaultOrigin = preference.defaultOrigin;
    defaultReportApprovalLine = preference.reportApprovalLine;
  }

  return (
    <TravelWorkspace
      user={{ displayName: user.displayName, email: user.email }}
      defaultOrigin={defaultOrigin}
      defaultReportApprovalLine={defaultReportApprovalLine}
      signOutPath={signOutPath("/")}
    />
  );
}
