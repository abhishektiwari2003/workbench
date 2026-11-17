import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
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
      <body className="min-h-screen bg-white font-sans text-zinc-900">
        {/* Clerk docs: the provider goes inside <body>. Keys come from .env.local only. */}
        <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/dashboard" signUpFallbackRedirectUrl="/dashboard">
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
