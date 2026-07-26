import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { cookieToInitialState, type Config } from "wagmi";
import { AppShell } from "@/components/shell";
import { DEV_AUTOCONNECT } from "@/lib/dev-wallet";
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
  // Autoconnect pins the read path to the fork. The account it connects exists
  // ONLY on anvil, so a leftover `sluice-rpc=mainnet` cookie from some earlier
  // session would leave the demo reading Base: an empty wallet, someone else's
  // book, and nothing on screen saying so — both venues are chainId 8453.
  const mode = DEV_AUTOCONNECT ? "local" : parseRpcMode(cookieHeader);
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
