import { createConnector } from "wagmi";
import type { Wallet } from "@rainbow-me/rainbowkit";

function xoConnector() {
  return createConnector((config) => {
    let provider: any = null;

    return {
      id: "xo-connect",
      name: "XO Wallet",
      type: "injected" as const,

      async setup() {},

      async connect({ chainId } = {} as any) {
        const { XOConnectProvider } = await import("xo-connect");
        provider = new XOConnectProvider({
          rpcs: {
            "0x1": "https://rpc.ankr.com/eth",
            "0x89": "https://rpc.ankr.com/polygon",
            "0xa4b1": "https://rpc.ankr.com/arbitrum",
            "0xa": "https://rpc.ankr.com/optimism",
            "0x2105": "https://rpc.ankr.com/base",
            "0xa86a": "https://rpc.ankr.com/avalanche",
            "0x38": "https://rpc.ankr.com/bsc",
          },
          defaultChainId: chainId
            ? `0x${chainId.toString(16)}`
            : "0x89",
        });

        const accounts = (await provider.request({
          method: "eth_requestAccounts",
        })) as string[];

        const currentChainId = (await provider.request({
          method: "eth_chainId",
        })) as string;

        // Listen for changes
        provider.on("chainChanged", (newChainId: string) => {
          config.emitter.emit("change", {
            chainId: parseInt(newChainId, 16),
          });
        });

        provider.on("accountsChanged", (newAccounts: string[]) => {
          if (newAccounts.length === 0) {
            config.emitter.emit("disconnect");
          } else {
            config.emitter.emit("change", {
              accounts: newAccounts as `0x${string}`[],
            });
          }
        });

        return {
          accounts: accounts as `0x${string}`[],
          chainId: parseInt(currentChainId, 16),
        };
      },

      async disconnect() {
        provider = null;
      },

      async getAccounts() {
        if (!provider) return [];
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as string[];
        return accounts as `0x${string}`[];
      },

      async getChainId() {
        if (!provider) return 137;
        const chainId = (await provider.request({
          method: "eth_chainId",
        })) as string;
        return parseInt(chainId, 16);
      },

      async getProvider() {
        return provider;
      },

      async isAuthorized() {
        if (!provider) return false;
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as string[];
        return accounts.length > 0;
      },

      async switchChain({ chainId }: { chainId: number }) {
        if (!provider) throw new Error("Not connected");
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${chainId.toString(16)}` }],
        });
        const chain = config.chains.find((c) => c.id === chainId);
        return chain ?? config.chains[0];
      },

      onAccountsChanged(accounts: string[]) {
        if (accounts.length === 0) {
          config.emitter.emit("disconnect");
        } else {
          config.emitter.emit("change", {
            accounts: accounts as `0x${string}`[],
          });
        }
      },

      onChainChanged(chainId: string) {
        config.emitter.emit("change", {
          chainId: parseInt(chainId, 16),
        });
      },

      onDisconnect() {
        config.emitter.emit("disconnect");
      },
    };
  });
}

export const xoWallet = (): Wallet => ({
  id: "xo-connect",
  name: "XO Wallet",
  iconUrl: "https://xo-connect.xolabs.io/favicon.ico",
  iconBackground: "#000000",
  installed: true,
  createConnector: xoConnector,
});
