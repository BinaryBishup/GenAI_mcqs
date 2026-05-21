import "./globals.css";
import type { Metadata } from "next";
import { Nunito_Sans } from "next/font/google";
import { cn } from "@/lib/utils";

const nunitoSans = Nunito_Sans({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "MCQ Agent Workflow",
  description: "Generate, plag-check, and verify multiple-choice questions with a Claude agentic pipeline.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", nunitoSans.variable)}>
      <body>{children}</body>
    </html>
  );
}
