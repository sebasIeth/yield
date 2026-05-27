import type { Wallet } from "@rainbow-me/rainbowkit";

function xoConnector() {
  // Use dynamic import to avoid type conflicts with wagmi's strict connector types
  const { createConnector } = require("wagmi") as any;

  return createConnector((config: any) => {
    let provider: any = null;

    return {
      id: "xo-connect",
      name: "XO Wallet",
      type: "injected",

      async setup() {},

      async connect({ chainId }: any = {}) {
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
          defaultChainId: chainId ? `0x${chainId.toString(16)}` : "0x89",
        });

        const accounts = await provider.request({ method: "eth_requestAccounts" });
        const currentChainId = await provider.request({ method: "eth_chainId" });

        provider.on("chainChanged", (id: string) => {
          config.emitter.emit("change", { chainId: parseInt(id, 16) });
        });
        provider.on("accountsChanged", (accs: string[]) => {
          if (accs.length === 0) config.emitter.emit("disconnect");
          else config.emitter.emit("change", { accounts: accs });
        });

        return { accounts, chainId: parseInt(currentChainId, 16) };
      },

      async disconnect() { provider = null; },

      async getAccounts() {
        if (!provider) return [];
        return provider.request({ method: "eth_accounts" });
      },

      async getChainId() {
        if (!provider) return 137;
        const id = await provider.request({ method: "eth_chainId" });
        return parseInt(id, 16);
      },

      async getProvider() { return provider; },

      async isAuthorized() {
        if (!provider) return false;
        const accs = await provider.request({ method: "eth_accounts" });
        return accs.length > 0;
      },

      async switchChain({ chainId }: any) {
        if (!provider) throw new Error("Not connected");
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${chainId.toString(16)}` }],
        });
        return config.chains.find((c: any) => c.id === chainId) ?? config.chains[0];
      },

      onAccountsChanged(accounts: string[]) {
        if (accounts.length === 0) config.emitter.emit("disconnect");
        else config.emitter.emit("change", { accounts });
      },
      onChainChanged(chainId: string) {
        config.emitter.emit("change", { chainId: parseInt(chainId, 16) });
      },
      onDisconnect() { config.emitter.emit("disconnect"); },
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
