const FEED_ID = /^0x[0-9a-fA-F]{64}$/;
export const MAX_FEEDS_PER_REQUEST = 4;

export function parseFeedIds(raw: string | null): string[] | null {
  if (!raw) return null;
  const ids = raw.split(",").map((id) => id.trim());
  if (ids.length === 0 || ids.length > MAX_FEEDS_PER_REQUEST || !ids.every((id) => FEED_ID.test(id))) return null;
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

export function hermesUrl(baseUrl: string, ids: string[]): string {
  const query = ids.map((id) => `ids[]=${id}`).join("&");
  return `${baseUrl.replace(/\/$/, "")}/v2/updates/price/latest?${query}&encoding=hex&parsed=false`;
}

/** Hermes returns hex payloads without a 0x prefix; the contract wants bytes. */
export function parseHermesUpdate(body: unknown): string[] | null {
  const data = (body as { binary?: { data?: unknown } } | null)?.binary?.data;
  if (!Array.isArray(data) || data.length === 0 || !data.every((item) => typeof item === "string")) return null;
  return (data as string[]).map((item) => (item.startsWith("0x") ? item : `0x${item}`));
}
