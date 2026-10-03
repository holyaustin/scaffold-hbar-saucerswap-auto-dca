import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseUnits } from "viem";
import { formatAgo, formatAmount, formatCountdown, formatInterval, shortAddress, skipReasonLabel, txUrl } from "~/lib/format";
import { decodeMirrorLogs, fetchVaultEvents } from "~/lib/mirror";
import { activeNetworkKey, auditTopicId, canTransact, activeNetwork, vaultAddress } from "~/lib/networks";
import { hermesUrl, parseFeedIds, parseHermesUpdate } from "~/lib/pyth";
import { vaultAbi } from "~/lib/vaultAbi";

const FEED = `0x${"ab".repeat(32)}`;

describe("format", () => {
  it("labels skip reasons and tolerates unknown codes", () => {
    expect(skipReasonLabel(1)).toBe("Price too old");
    expect(skipReasonLabel(4)).toBe("Pool price worse than oracle");
    expect(skipReasonLabel(99)).toBe("Unknown");
  });

  it("formats amounts without trailing zeros", () => {
    expect(formatAmount(parseUnits("50", 8), 8)).toBe("50");
    expect(formatAmount(parseUnits("1.23456789", 8), 8)).toBe("1.2345");
    expect(formatAmount(0n, 6)).toBe("0");
  });

  it("formats countdowns and intervals", () => {
    expect(formatCountdown(100, 200)).toBe("due now");
    expect(formatCountdown(145, 100)).toBe("in 45s");
    expect(formatCountdown(225, 100)).toBe("in 2m 05s");
    expect(formatCountdown(100 + 3780, 100)).toBe("in 1h 03m");
    expect(formatInterval(120)).toBe("2 min");
    expect(formatInterval(3600)).toBe("1 hour");
    expect(formatInterval(172800)).toBe("2 days");
    expect(formatInterval(90)).toBe("90s");
  });

  it("formats how long ago something happened", () => {
    expect(formatAgo(100, 130)).toBe("30s ago");
    expect(formatAgo(100, 400)).toBe("5m ago");
    expect(formatAgo(100, 100 + 7300)).toBe("2h ago");
    expect(formatAgo(100, 100 + 2 * 86400 + 5)).toBe("2d ago");
    expect(formatAgo(200, 100)).toBe("just now");
  });

  it("shortens addresses and builds explorer links", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(txUrl("https://hashscan.io/testnet", "0xabc")).toBe("https://hashscan.io/testnet/transaction/0xabc");
  });
});

describe("networks", () => {
  it("defaults to testnet and treats mainnet as view-only", () => {
    expect(activeNetworkKey(undefined)).toBe("testnet");
    expect(activeNetworkKey("garbage")).toBe("testnet");
    expect(activeNetworkKey("mainnet")).toBe("mainnet");
    expect(canTransact(activeNetwork("testnet"))).toBe(true);
    expect(canTransact(activeNetwork("mainnet"))).toBe(false);
  });

  it("only accepts well-formed vault addresses", () => {
    const good = "0x1234567890abcdef1234567890abcdef12345678";
    expect(vaultAddress("testnet", good)).toBe(good);
    expect(vaultAddress("testnet", "not-an-address")).toBeNull();
    expect(vaultAddress("mainnet", "")).toBeNull();
  });
});

describe("audit topic", () => {
  it("accepts only well-formed Hedera topic ids", () => {
    expect(auditTopicId("testnet", "0.0.12345")).toBe("0.0.12345");
    expect(auditTopicId("testnet", " 0.0.12345 ")).toBe("0.0.12345");
    expect(auditTopicId("testnet", "not-a-topic")).toBeNull();
    expect(auditTopicId("testnet", "0.0.1; drop")).toBeNull();
    expect(auditTopicId("mainnet", "")).toBeNull();
  });
});

describe("pyth helpers", () => {
  it("validates and de-duplicates feed ids", () => {
    expect(parseFeedIds(null)).toBeNull();
    expect(parseFeedIds("0x1234")).toBeNull();
    expect(parseFeedIds(`${FEED},${FEED.toUpperCase().replace("0X", "0x")}`)).toEqual([FEED]);
    expect(parseFeedIds(Array(5).fill(FEED).join(","))).toBeNull();
  });

  it("builds Hermes URLs and prefixes payloads with 0x", () => {
    expect(hermesUrl("https://hermes.example/", [FEED])).toBe(
      `https://hermes.example/v2/updates/price/latest?ids[]=${FEED}&encoding=hex&parsed=false`,
    );
    expect(parseHermesUpdate({ binary: { data: ["aabb", "0xccdd"] } })).toEqual(["0xaabb", "0xccdd"]);
    expect(parseHermesUpdate({ binary: { data: [] } })).toBeNull();
    expect(parseHermesUpdate(null)).toBeNull();
  });
});

describe("mirror node log decoding", () => {
  const topics = encodeEventTopics({ abi: vaultAbi, eventName: "RunSkipped", args: { planId: 7n } });
  const data = encodeAbiParameters([{ type: "uint8" }], [1]);
  const log = { topics: topics.map(String), data, transaction_hash: "0xfeed", timestamp: "1790000000.123456789" };

  it("decodes vault events and ignores foreign logs", () => {
    const events = decodeMirrorLogs([log, { ...log, topics: [`0x${"11".repeat(32)}`] }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: "RunSkipped", txHash: "0xfeed", timestamp: 1790000000 });
    expect(events[0].args).toMatchObject({ planId: 7n, reason: 1 });
  });

  it("fetches from the contract logs endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ logs: [log] }) });
    const events = await fetchVaultEvents("https://mirror.example", "0xvault", 5, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith("https://mirror.example/api/v1/contracts/0xvault/results/logs?order=desc&limit=5");
    expect(events).toHaveLength(1);
  });

  it("surfaces mirror node failures", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(fetchVaultEvents("https://mirror.example", "0xvault", 5, fetcher as unknown as typeof fetch)).rejects.toThrow(
      "Mirror node returned 503",
    );
  });
});

import { parsePlanForm, type PlanFormValues } from "~/lib/planForm";

describe("parsePlanForm", () => {
  const valid: PlanFormValues = {
    tokenIn: "0x1111111111111111111111111111111111111111",
    tokenOut: "0x2222222222222222222222222222222222222222",
    fee: "3000",
    amountPerRun: "1.5",
    runs: "3",
    intervalSeconds: "120",
    maxSlippagePct: "5",
    maxConfPct: "2",
    maxPriceAge: "3600",
    priceIdIn: `0x${"aa".repeat(32)}`,
    priceIdOut: `0x${"bb".repeat(32)}`,
  };

  it("converts a valid form to contract units", () => {
    const result = parsePlanForm(valid);
    expect(result).toMatchObject({
      ok: true,
      value: { fee: 3000, runs: 3, intervalSeconds: 120, maxSlippageBps: 500, maxConfBps: 200, maxPriceAge: 3600 },
    });
  });

  it.each([
    [{ tokenIn: "0x123" }, "42 characters"],
    [{ tokenOut: valid.tokenIn }, "must be different"],
    [{ fee: "42" }, "fee tier"],
    [{ amountPerRun: "0" }, "greater than zero"],
    [{ amountPerRun: "abc" }, "greater than zero"],
    [{ runs: "0" }, "1 to 365"],
    [{ runs: "1.5" }, "1 to 365"],
    [{ intervalSeconds: "30" }, "at least 60"],
    [{ maxSlippagePct: "75" }, "0% and 50%"],
    [{ maxConfPct: "-1" }, "0% and 100%"],
    [{ maxPriceAge: "0" }, "1 to 86400"],
    [{ priceIdIn: "0x1234" }, "price feed IDs"],
  ])("rejects %j", (override, message) => {
    const result = parsePlanForm({ ...valid, ...override });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});

import { describeEvents } from "~/lib/activity";

describe("describeEvents", () => {
  const plans = new Map([["1", { symbolOut: "WHBAR", decimalsOut: 8 }]]);
  const base = { txHash: "0xaa", timestamp: 1 };

  it("describes runs and skips for the user's own plans only", () => {
    const lines = describeEvents(
      [
        { ...base, name: "RunExecuted", args: { planId: 1n, amountOut: 5_000_000_000n } },
        { ...base, name: "RunSkipped", args: { planId: 1n, reason: 1 } },
        { ...base, name: "RunExecuted", args: { planId: 2n, amountOut: 1n } },
        { ...base, name: "RunScheduled", args: { planId: 1n } },
      ],
      plans,
    );
    expect(lines.map((line) => line.text)).toEqual([
      "Plan 1: Bought 50 WHBAR",
      "Plan 1: Skipped a purchase: price too old",
    ]);
  });

  it("explains automatic pauses and schedule failures", () => {
    const lines = describeEvents(
      [
        { ...base, name: "PlanPaused", args: { planId: 1n, automatic: true } },
        { ...base, name: "ScheduleFailed", args: { planId: 1n, responseCode: 366n } },
      ],
      plans,
    );
    expect(lines[0].text).toContain("five skipped");
    expect(lines[1].text).toContain("Run now");
  });
});
