import type { Metadata } from "next";
import "./globals.css";
import "./smartcogen.css";

export const metadata: Metadata = {
  title: "SmartCoGen — Mercer | Mettl",
  description: "Generate, ground, plag-check, and verify original MCQs with Claude.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
