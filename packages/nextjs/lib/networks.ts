import { LOCAL_DEMO, NETWORKS, saucerSwapAddresses, type NetworkKey } from "@auto-dca/config";
import deployments from "./deployments.json";

type DeploymentRecord = { vault: string; deployedAt?: string; hcsTopicId?: string } | null;

/** The two real networks plus the offline demo network. */
export type ChainKey = NetworkKey | "local";

/** Everything the UI needs to know about a network, whether it is real or the local demo. */
export interface ActiveNetwork {
  key: ChainKey;
  label: string;
  status: "live" | "coming-soon";
  chainId: number;
  rpcUrl: string;
  mirrorUrl: string | null;
  explorerUrl: string | null;
  pyth: `0x${string}` | null;
  quoter: `0x${string}` | null;
}

/** Resolve the configured network. Unknown values fall back to testnet instead of crashing the page. */
export function activeNetworkKey(raw: string | undefined = process.env.NEXT_PUBLIC_HEDERA_NETWORK): ChainKey {
  if (raw === "mainnet" || raw === "local") return raw;
  return "testnet";
}

export function activeNetwork(key: ChainKey = activeNetworkKey()): ActiveNetwork {
  if (key === "local") {
    return {
      key,
      label: LOCAL_DEMO.label,
      status: LOCAL_DEMO.status,
      chainId: LOCAL_DEMO.chainId,
      rpcUrl: LOCAL_DEMO.rpcUrl,
      mirrorUrl: null,
      explorerUrl: null,
      pyth: null,
      quoter: null, // supplied by the demo config at runtime
    };
  }
  const network = NETWORKS[key];
  return {
    key,
    label: network.label,
    status: network.status,
    chainId: network.chainId,
    rpcUrl: network.rpcUrl,
    mirrorUrl: network.mirrorUrl,
    explorerUrl: network.explorerUrl,
    pyth: network.pyth as `0x${string}`,
    quoter: saucerSwapAddresses(key).quoter as `0x${string}`,
  };
}

/** The vault for a network: an explicit env override wins, otherwise what the deploy script recorded. */
export function vaultAddress(key: ChainKey, override: string | undefined = process.env.NEXT_PUBLIC_VAULT_ADDRESS): `0x${string}` | null {
  if (key === "local") return null; // the demo supplies its own at runtime
  const candidate = override?.trim() || (deployments as Record<string, DeploymentRecord>)[key]?.vault;
  return candidate && /^0x[0-9a-fA-F]{40}$/.test(candidate) ? (candidate as `0x${string}`) : null;
}

export function canTransact(network: Pick<ActiveNetwork, "status">): boolean {
  return network.status === "live";
}

const TOPIC_ID = /^\d+\.\d+\.\d+$/;

/** The HCS audit topic the optional relay publishes to, if one has been set up. */
export function auditTopicId(key: ChainKey, override: string | undefined = process.env.NEXT_PUBLIC_HCS_TOPIC_ID): string | null {
  if (key === "local") return null;
  const candidate = override?.trim() || (deployments as Record<string, DeploymentRecord>)[key]?.hcsTopicId;
  return candidate && TOPIC_ID.test(candidate) ? candidate : null;
}
