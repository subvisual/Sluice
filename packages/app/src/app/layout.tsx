import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { cookieToInitialState, type Config } from "wagmi";
import { AppShell } from "@/components/shell";
import { parseRpcMode } from "@/lib/network";
import { getAdapter } from "@/lib/wagmi";
import { Providers } from "./providers";
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
  title: "Sluice",
  description: "Address SwapVM in a sentence.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieHeader = (await headers()).get("cookie");
  const mode = parseRpcMode(cookieHeader);
  const initialState = cookieToInitialState(
    getAdapter(mode).wagmiConfig as Config,
    cookieHeader,
  );

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body>
        <Providers initialState={initialState} mode={mode}>
          <AppShell mode={mode}>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
