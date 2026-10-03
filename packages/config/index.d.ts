export type NetworkKey = "testnet" | "mainnet";
export type NetworkStatus = "live" | "coming-soon";

export interface SaucerSwapIds {
  readonly swapRouterId: string;
  readonly quoterId: string;
  readonly factoryId: string;
  readonly whbarTokenId: string;
}

export interface NetworkConfig {
  readonly key: NetworkKey;
  readonly label: string;
  readonly status: NetworkStatus;
  readonly chainId: number;
  readonly hardhatName: string;
  readonly rpcUrl: string;
  readonly mirrorUrl: string;
  readonly explorerUrl: string;
  readonly faucetUrl: string | null;
  readonly pyth: string;
  readonly saucerSwap: SaucerSwapIds;
}

export interface SaucerSwapAddresses {
  swapRouter: string;
  quoter: string;
  factory: string;
  whbarToken: string;
}

export const NETWORKS: Readonly<Record<NetworkKey, NetworkConfig>>;
export const SYSTEM_CONTRACTS: Readonly<{ hts: string; hss: string }>;
export const PYTH_EVM_ADDRESS: string;
export const POOL_FEE_TIERS: ReadonlyArray<Readonly<{ fee: number; label: string }>>;

export function idToEvmAddress(id: string): string;
export function isLive(network: { status: string }): boolean;
export function resolveNetworkKey(key: string | undefined | null): NetworkKey;
export function saucerSwapAddresses(key: NetworkKey): SaucerSwapAddresses;
