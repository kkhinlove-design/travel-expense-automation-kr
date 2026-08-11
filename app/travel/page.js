import TravelWorkspace from "./travel-workspace";
import { requireAuthenticatedUser, signOutPath } from "../auth";
import { APP_DESCRIPTION, APP_TITLE } from "@/config/organization";

export const dynamic = "force-dynamic";

export const metadata = {
  title: APP_TITLE,
  description: APP_DESCRIPTION,
};

export default async function TravelPage() {
  const user = await requireAuthenticatedUser("/travel");
  return <TravelWorkspace user={{ displayName: user.displayName, email: user.email }} signOutPath={signOutPath("/travel")} />;
}
