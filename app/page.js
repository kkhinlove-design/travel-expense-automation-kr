import TravelWorkspace from "./travel/travel-workspace";
import { requireAuthenticatedUser, signOutPath } from "./auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireAuthenticatedUser("/");

  return (
    <TravelWorkspace
      user={{ displayName: user.displayName, email: user.email }}
      signOutPath={signOutPath("/")}
    />
  );
}
