import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sync-Content - Sitecore transfer wizard",
  description:
    "Embedded Sitecore Marketplace app for guided Content Transfer and Item Transfer workflows.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
