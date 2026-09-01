import { cookies } from "next/headers";
import { parseUiMode, UI_MODE_COOKIE_NAME } from "@/lib/ui-mode";
import HomePageClient from "./home-page-client";

export default async function HomePage() {
  const cookieStore = await cookies();
  const cookieMode = parseUiMode(cookieStore.get(UI_MODE_COOKIE_NAME)?.value);

  return (
    <HomePageClient
      hasInitialUiModeCookie={Boolean(cookieMode)}
      initialUiMode={cookieMode ?? "clean"}
    />
  );
}
