import { NETWORKS, isLive, type NetworkConfig } from "@auto-dca/config";

/**
 * Map a Hardhat network name to a live Hedera network, or explain why we cannot deploy there.
 * Mainnet is configured but deliberately blocked until its status is set to "live".
 */
export function resolveDeployTarget(hardhatNetworkName: string): NetworkConfig {
  const match = Object.values(NETWORKS).find((network) => network.hardhatName === hardhatNetworkName);
  if (!match) {
    throw new Error(
      `Network "${hardhatNetworkName}" is not a Hedera deploy target. Use --network hederaTestnet.`,
    );
  }
  if (!isLive(match)) {
    throw new Error(
      `${match.label} is coming soon. This template deploys to Hedera testnet only for now. ` +
        `Re-run with --network hederaTestnet.`,
    );
  }
  return match;
}
