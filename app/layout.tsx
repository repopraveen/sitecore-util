import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Content Courier — Sitecore content transfer",
  description:
    "Securely courier content between SitecoreAI environments using the Content Transfer and Item Transfer APIs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
