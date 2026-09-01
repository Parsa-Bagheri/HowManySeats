import type { Metadata } from "next";
import Script from "next/script";
import { UI_MODE_COOKIE_NAME, UI_MODE_STORAGE_KEY } from "@/lib/ui-mode";
import "./globals.css";

export const metadata: Metadata = {
  title: "HowManySeats?",
  description: "Find how many seats are left at nearby Cineplex showtimes.",
};

const uiModeBootstrapScript = `
(function () {
  try {
    var storageKey = ${JSON.stringify(UI_MODE_STORAGE_KEY)};
    var cookieName = ${JSON.stringify(UI_MODE_COOKIE_NAME)};
    var savedMode = window.localStorage.getItem(storageKey);
    var modeCookie = document.cookie.split("; ").find(function (cookie) {
      return cookie.indexOf(cookieName + "=") === 0;
    });
    var cookieValue = modeCookie ? decodeURIComponent(modeCookie.slice(cookieName.length + 1)) : "";
    var hasCookie = cookieValue === "clean" || cookieValue === "fun";

    if (savedMode === "fun" && !hasCookie) {
      document.documentElement.setAttribute("data-ui-mode-pending", "fun");
    }
  } catch {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Script id="ui-mode-bootstrap" strategy="beforeInteractive">
          {uiModeBootstrapScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
