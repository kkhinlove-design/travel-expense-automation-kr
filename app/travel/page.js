import TravelWorkspace from "./travel-workspace";
import { requireAuthenticatedUser, signOutPath } from "../auth";
import { APP_DESCRIPTION, APP_TITLE } from "@/config/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadTravelUserPreference } from "@/lib/travel-user-preferences";

export const dynamic = "force-dynamic";

export const metadata = {
  title: APP_TITLE,
  description: APP_DESCRIPTION,
};

export default async function TravelPage() {
  const user = await requireAuthenticatedUser("/travel");
  let defaultOrigin = "";
  if (user.userId !== "local-development-user") {
    const client = await createSupabaseServerClient();
    const preference = await loadTravelUserPreference(client, user.userId);
    defaultOrigin = preference.defaultOrigin;
  }
  return <TravelWorkspace user={{ displayName: user.displayName, email: user.email }} defaultOrigin={defaultOrigin} signOutPath={signOutPath("/travel")} />;
}
