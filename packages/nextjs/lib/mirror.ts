import { decodeEventLog, type Hex } from "viem";
import { vaultAbi } from "./vaultAbi";

export interface MirrorLog {
  topics: string[];
  data: string;
  transaction_hash: string;
  timestamp: string; // "seconds.nanoseconds"
}

export interface VaultEvent {
  name: string;
  args: Record<string, unknown>;
  txHash: string;
  /** Unix seconds from the consensus timestamp. */
  timestamp: number;
}

/** Decode raw mirror-node logs into vault events, silently dropping anything that is not ours. */
export function decodeMirrorLogs(logs: MirrorLog[]): VaultEvent[] {
  const events: VaultEvent[] = [];
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: vaultAbi,
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
      });
      events.push({
        name: decoded.eventName,
        args: (decoded.args ?? {}) as Record<string, unknown>,
        txHash: log.transaction_hash,
        timestamp: Math.floor(Number(log.timestamp)),
      });
    } catch {
      // Not a vault event (or an ABI mismatch): ignore it.
    }
  }
  return events;
}

export async function fetchVaultEvents(
  mirrorUrl: string,
  vault: string,
  limit = 100,
  fetcher: typeof fetch = fetch,
): Promise<VaultEvent[]> {
  const response = await fetcher(`${mirrorUrl}/api/v1/contracts/${vault}/results/logs?order=desc&limit=${limit}`);
  if (!response.ok) throw new Error(`Mirror node returned ${response.status}`);
  const body = (await response.json()) as { logs?: MirrorLog[] };
  return decodeMirrorLogs(body.logs ?? []);
}
