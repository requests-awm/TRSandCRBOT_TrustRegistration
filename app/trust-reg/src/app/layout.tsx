import type { Metadata } from "next";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import { publicConfigScript, readServerPublicConfig } from "@/lib/publicConfig";
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
  title: "Trust Registration Monitor",
  description: "AWM non-AEP provider trust registration (TRS / CRBOT) monitoring",
};

// Rendered per request so the browser receives the runtime configuration of the environment it is
// served from (one container image for every environment). See src/lib/publicConfig.ts.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const cfg = readServerPublicConfig();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script id="trust-reg-config" dangerouslySetInnerHTML={{ __html: publicConfigScript(cfg) }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
