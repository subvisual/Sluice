"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, type Config, type State } from "wagmi";
import { initAppKit } from "@/lib/appkit";
import { BookProvider } from "@/lib/book";
import { type RpcMode } from "@/lib/network";
import { getAdapter } from "@/lib/wagmi";

export function Providers({
  children,
  initialState,
  mode,
}: {
  children: ReactNode;
  initialState: State | undefined;
  mode: RpcMode;
}) {
  const [config] = useState(() => {
    const adapter = getAdapter(mode);
    initAppKit(adapter, mode);
    return adapter.wagmiConfig as Config;
  });
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <BookProvider>{children}</BookProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
