import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type Address,
  type EIP1193Provider,
} from "viem";
import type { NetworkConfig } from "@auto-dca/config";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

/** Gas limits for Hedera, where HTS and HSS calls make estimates unreliable. Testnet HBAR is free. */
export const GAS = {
  approve: 800_000n,
  associate: 800_000n,
  createPlan: 2_500_000n,
  execute: 2_000_000n,
  manage: 1_000_000n,
  refreshPrice: 1_500_000n,
} as const;

/** Inside the EVM, Hedera counts HBAR in tinybar (8 decimals). JSON-RPC clients send weibar (18). */
export const TINYBAR_TO_WEIBAR = 10n ** 10n;

export function hederaChain(network: NetworkConfig) {
  return defineChain({
    id: network.chainId,
    name: network.label,
    nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
    blockExplorers: { default: { name: "HashScan", url: network.explorerUrl } },
  });
}

export function publicClientFor(network: NetworkConfig) {
  return createPublicClient({ chain: hederaChain(network), transport: http(network.rpcUrl) });
}

export function injectedProvider(): EIP1193Provider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet found. Install an EVM wallet such as MetaMask, then reload this page.");
  }
  return window.ethereum;
}

export async function switchToNetwork(provider: EIP1193Provider, network: NetworkConfig): Promise<void> {
  const chainId = `0x${network.chainId.toString(16)}` as const;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    // 4902 means the wallet does not know this chain yet.
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: network.label,
          nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
          rpcUrls: [network.rpcUrl],
          blockExplorerUrls: [network.explorerUrl],
        },
      ],
    });
  }
}

export async function connectWallet(network: NetworkConfig): Promise<Address> {
  const provider = injectedProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  await switchToNetwork(provider, network);
  const account = accounts[0];
  if (!account) throw new Error("The wallet did not return an account.");
  return account;
}

export function walletClientFor(network: NetworkConfig) {
  return createWalletClient({ chain: hederaChain(network), transport: custom(injectedProvider()) });
}

/** Pull the most readable message out of a viem or wallet error. */
export function describeError(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { shortMessage?: string; message?: string };
    if (candidate.shortMessage) return candidate.shortMessage;
    if (candidate.message) return candidate.message.split("\n")[0];
  }
  return "Something went wrong.";
}
