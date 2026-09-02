import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HowManySeats?",
  description:
    "Estimate open and occupied seats at nearby Cineplex and Landmark Cinemas showtimes.",
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
