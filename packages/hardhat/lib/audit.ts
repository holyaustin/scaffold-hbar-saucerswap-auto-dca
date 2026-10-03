import type { Interface } from "ethers";

/** One log as returned by the mirror node's `/contracts/{id}/results/logs` endpoint. */
export interface MirrorLog {
  topics: string[];
  data: string;
  transaction_hash: string;
  timestamp: string; // "seconds.nanoseconds"
  index: number; // position of the log inside its transaction
}

/** Resume point. Several logs share one timestamp, so the index is part of the cursor. */
export interface Cursor {
  timestamp: string;
  index: number;
}

export interface AuditRecord {
  v: 1;
  vault: string;
  chainId: number;
  event: string;
  planId: string;
  args: Record<string, string>;
  txHash: string;
  consensusTimestamp: string;
}

/** Events that tell the story of a plan. Bookkeeping events such as RunScheduled stay out of the trail. */
export const RELAYED_EVENTS: ReadonlySet<string> = new Set([
  "PlanCreated",
  "RunExecuted",
  "RunSkipped",
  "ScheduleFailed",
  "PlanPaused",
  "PlanResumed",
  "PlanCompleted",
  "PlanCancelled",
  "Claimed",
]);

/** HCS allows 1024 bytes per message. Stay under it with room to spare. */
export const MAX_MESSAGE_BYTES = 1000;

const NANOS = 10n ** 9n;

function toNanos(timestamp: string): bigint {
  const [seconds, fraction = ""] = timestamp.split(".");
  return BigInt(seconds) * NANOS + BigInt(fraction.padEnd(9, "0").slice(0, 9));
}

function compareLogs(a: { timestamp: string; index: number }, b: { timestamp: string; index: number }): number {
  const left = toNanos(a.timestamp);
  const right = toNanos(b.timestamp);
  if (left !== right) return left < right ? -1 : 1;
  return a.index - b.index;
}

/** Logs strictly after the cursor, oldest first. A null cursor means "from the beginning". */
export function selectNewLogs(logs: MirrorLog[], cursor: Cursor | null): MirrorLog[] {
  return logs.filter((log) => cursor === null || compareLogs(log, cursor) > 0).sort(compareLogs);
}

export function cursorOf(log: MirrorLog): Cursor {
  return { timestamp: log.timestamp, index: log.index };
}

/** Turn a raw log into an audit record, or null when it is not an event we relay. */
export function toAuditRecord(iface: Interface, log: MirrorLog, vault: string, chainId: number): AuditRecord | null {
  const parsed = iface.parseLog({ topics: log.topics, data: log.data });
  if (!parsed || !RELAYED_EVENTS.has(parsed.name)) return null;

  const args: Record<string, string> = {};
  parsed.fragment.inputs.forEach((input, position) => {
    args[input.name] = String(parsed.args[position]);
  });
  const { planId, ...rest } = args;

  return {
    v: 1,
    vault,
    chainId,
    event: parsed.name,
    planId: planId ?? "",
    args: rest,
    txHash: log.transaction_hash,
    consensusTimestamp: log.timestamp,
  };
}

export function encodeMessage(record: AuditRecord): string {
  const message = JSON.stringify(record);
  if (Buffer.byteLength(message, "utf8") > MAX_MESSAGE_BYTES) {
    throw new Error(`Audit message is larger than ${MAX_MESSAGE_BYTES} bytes and cannot be published to HCS.`);
  }
  return message;
}

export function logsUrl(mirrorUrl: string, vault: string, cursor: Cursor | null, limit = 100): string {
  // gte (not gt): logs of one transaction share a timestamp, and the cursor index filters the rest locally.
  const since = cursor ? `&timestamp=gte:${cursor.timestamp}` : "";
  return `${mirrorUrl}/api/v1/contracts/${vault}/results/logs?order=asc&limit=${limit}${since}`;
}
