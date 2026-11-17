import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CoCareer: only the jobs worth applying to",
  description:
    "Upload your resume and CoCareer reads every open role at Stripe, OpenAI, Databricks and 7 more, then shows only your strong matches with the reasons why.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <body className="min-h-screen bg-white font-sans text-zinc-900">{children}</body>
    </html>
  );
}
