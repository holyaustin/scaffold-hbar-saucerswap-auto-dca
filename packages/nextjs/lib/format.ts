import { formatUnits } from "viem";

const SKIP_REASONS = ["None", "Price too old", "Price too uncertain", "Price invalid", "Pool price worse than oracle"] as const;

export function skipReasonLabel(reason: number): string {
  return SKIP_REASONS[reason] ?? "Unknown";
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** Human-readable token amount with a capped number of decimals, e.g. 50.1234. */
export function formatAmount(raw: bigint, decimals: number, maxFraction = 4): string {
  const [whole, fraction = ""] = formatUnits(raw, decimals).split(".");
  const trimmed = fraction.slice(0, maxFraction).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/** "in 2m 05s", "in 1h 03m", or "due now". */
export function formatCountdown(targetUnixSeconds: number, nowUnixSeconds: number): string {
  const remaining = targetUnixSeconds - nowUnixSeconds;
  if (remaining <= 0) return "due now";
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  if (hours > 0) return `in ${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `in ${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `in ${seconds}s`;
}

/** "30s ago", "5m ago", "2h ago", "2d ago". */
export function formatAgo(timestampUnixSeconds: number, nowUnixSeconds: number): string {
  const elapsed = nowUnixSeconds - timestampUnixSeconds;
  if (elapsed <= 0) return "just now";
  if (elapsed < 60) return `${elapsed}s ago`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`;
  return `${Math.floor(elapsed / 86400)}d ago`;
}

export function formatInterval(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? "" : "s"}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds}s`;
}

export function txUrl(explorerUrl: string, hash: string): string {
  return `${explorerUrl}/transaction/${hash}`;
}

/** A HashScan link when the network has an explorer, otherwise null (the local demo has none). */
export function txLink(explorerUrl: string | null, hash: string): string | null {
  return explorerUrl ? txUrl(explorerUrl, hash) : null;
}
