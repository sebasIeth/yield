"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import {
  RainbowKitProvider,
  darkTheme,
  connectorsForWallets,
} from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  coinbaseWallet,
  phantomWallet,
  rabbyWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { xoWallet } from "@/lib/xo-wallet";
import {
  mainnet,
  polygon,
  arbitrum,
  optimism,
  base,
  avalanche,
  bsc,
} from "wagmi/chains";
import "@rainbow-me/rainbowkit/styles.css";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [xoWallet],
    },
    {
      groupName: "Other Wallets",
      wallets: [
        metaMaskWallet,
        coinbaseWallet,
        phantomWallet,
        rabbyWallet,
        injectedWallet,
      ],
    },
  ],
  {
    appName: "Yield Dashboard",
    projectId: "NONE",
  }
);

const config = createConfig({
  connectors,
  chains: [mainnet, polygon, arbitrum, optimism, base, avalanche, bsc],
  transports: {
    [mainnet.id]: http("https://rpc.ankr.com/eth"),
    [polygon.id]: http("https://rpc.ankr.com/polygon"),
    [arbitrum.id]: http("https://rpc.ankr.com/arbitrum"),
    [optimism.id]: http("https://rpc.ankr.com/optimism"),
    [base.id]: http("https://rpc.ankr.com/base"),
    [avalanche.id]: http("https://rpc.ankr.com/avalanche"),
    [bsc.id]: http("https://rpc.ankr.com/bsc"),
  },
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#6366f1",
            accentColorForeground: "white",
            borderRadius: "medium",
            overlayBlur: "small",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
