import { NETWORKS, isLive, type NetworkConfig, type NetworkKey } from "@auto-dca/config";
import deployments from "./deployments.json";

type DeploymentRecord = { vault: string; deployedAt?: string; hcsTopicId?: string } | null;

/** Resolve the configured network. Unknown values fall back to testnet instead of crashing the page. */
export function activeNetworkKey(raw: string | undefined = process.env.NEXT_PUBLIC_HEDERA_NETWORK): NetworkKey {
  return raw === "mainnet" ? "mainnet" : "testnet";
}

export function activeNetwork(key: NetworkKey = activeNetworkKey()): NetworkConfig {
  return NETWORKS[key];
}

/** The vault for a network: an explicit env override wins, otherwise what the deploy script recorded. */
export function vaultAddress(key: NetworkKey, override: string | undefined = process.env.NEXT_PUBLIC_VAULT_ADDRESS): `0x${string}` | null {
  const candidate = override?.trim() || (deployments as Record<string, DeploymentRecord>)[key]?.vault;
  return candidate && /^0x[0-9a-fA-F]{40}$/.test(candidate) ? (candidate as `0x${string}`) : null;
}

export function canTransact(network: NetworkConfig): boolean {
  return isLive(network);
}

const TOPIC_ID = /^\d+\.\d+\.\d+$/;

/** The HCS audit topic the optional relay publishes to, if one has been set up. */
export function auditTopicId(key: NetworkKey, override: string | undefined = process.env.NEXT_PUBLIC_HCS_TOPIC_ID): string | null {
  const candidate = override?.trim() || (deployments as Record<string, DeploymentRecord>)[key]?.hcsTopicId;
  return candidate && TOPIC_ID.test(candidate) ? candidate : null;
}
