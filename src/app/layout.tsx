import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HowManySeats?",
  description: "Find how many seats are left at nearby Cineplex showtimes.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
