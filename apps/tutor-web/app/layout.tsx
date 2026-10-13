import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import { AuthGate } from "@/features/auth/AuthGate";
import { LOGO_APPLE, LOGO_PNG, LOGO_SRC } from "@/lib/brand";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ceeq — AI Tutor",
  description: "Learn every chapter of your syllabus with Ceeq, a voice tutor that teaches until you understand.",
  // The tab of the browser and the home screen of a phone show the logo too.
  icons: {
    icon: [
      { url: LOGO_SRC, type: "image/svg+xml" },
      { url: LOGO_PNG, type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: LOGO_APPLE, sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c10" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
