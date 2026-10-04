import { decodeEventLog, type Address, type Hex, type PublicClient } from "viem";
import type { VaultEvent } from "./mirror";
import { vaultAbi } from "./vaultAbi";

/**
 * Vault events for the local demo. There is no mirror node on a local chain, so read the logs from the
 * node directly and take each event's time from its block.
 */
export async function fetchLocalEvents(
  client: Pick<PublicClient, "getLogs" | "getBlock">,
  vault: Address,
): Promise<VaultEvent[]> {
  const logs = await client.getLogs({ address: vault, fromBlock: 0n, toBlock: "latest" });
  const blockNumbers = [...new Set(logs.map((log) => log.blockNumber))];
  const times = new Map<bigint, number>();
  await Promise.all(
    blockNumbers.map(async (blockNumber) => {
      const block = await client.getBlock({ blockNumber });
      times.set(blockNumber, Number(block.timestamp));
    }),
  );

  const events: VaultEvent[] = [];
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: vaultAbi, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]] });
      events.push({
        name: decoded.eventName,
        args: (decoded.args ?? {}) as Record<string, unknown>,
        txHash: log.transactionHash,
        timestamp: times.get(log.blockNumber) ?? 0,
      });
    } catch {
      // Not one of the vault's events.
    }
  }
  return events.reverse(); // newest first, like the mirror node feed
}
