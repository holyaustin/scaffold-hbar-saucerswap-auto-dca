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

import { comparePoolToOracle, describeGuard, quoterAbi } from "~/lib/quote";
import { parseDemoConfig } from "~/lib/demo";
import { fetchLocalEvents } from "~/lib/localEvents";
import { txLink } from "~/lib/format";

describe("pool versus oracle", () => {
  it("measures the gap and whether the swap would pass", () => {
    // Oracle expects 50, floor is 47.5 (5% slippage), in 8-decimal units.
    const expected = 5_000_000_000n;
    const minimum = 4_750_000_000n;
    expect(comparePoolToOracle(5_000_000_000n, expected, minimum)).toEqual({ gapBps: 0, passes: true });
    expect(comparePoolToOracle(4_800_000_000n, expected, minimum)).toEqual({ gapBps: 400, passes: true });
    expect(comparePoolToOracle(4_000_000_000n, expected, minimum)).toEqual({ gapBps: 2000, passes: false });
    expect(comparePoolToOracle(5_100_000_000n, expected, minimum)).toEqual({ gapBps: -200, passes: true });
    expect(comparePoolToOracle(1n, 0n, 0n).gapBps).toBe(0);
  });

  const base = { symbolOut: "WHBAR", decimalsOut: 8, maxSlippageBps: 500 };
  const preview = { reason: 0, expected: 5_000_000_000n, minimum: 4_750_000_000n };

  it("explains a skip caused by the oracle itself", () => {
    const verdict = describeGuard({ ...base, preview: { ...preview, reason: 1 }, quote: null });
    expect(verdict).toEqual({ tone: "hold", text: "Price guard would skip right now: price too old." });
  });

  it("predicts a skip when the pool pays too little, before any gas is spent", () => {
    const verdict = describeGuard({ ...base, preview, quote: 4_000_000_000n });
    expect(verdict.tone).toBe("hold");
    expect(verdict.text).toContain("pool pays 40 WHBAR, 20% less than the oracle's 50 WHBAR");
    expect(verdict.text).toContain("Your limit is 5%");
  });

  it("says go with the live comparison when the pool is within the limit", () => {
    expect(describeGuard({ ...base, preview, quote: 4_800_000_000n }).text).toContain("4% under the oracle's 50 WHBAR");
    expect(describeGuard({ ...base, preview, quote: 5_000_000_000n }).text).toContain("level with the oracle's 50 WHBAR");
    expect(describeGuard({ ...base, preview, quote: 5_100_000_000n }).text).toContain("2% over the oracle's 50 WHBAR");
  });

  it("still gives a useful answer when no pool quote is available", () => {
    const verdict = describeGuard({ ...base, preview, quote: null });
    expect(verdict.tone).toBe("go");
    expect(verdict.text).toContain("pool quote is not available");
  });

  it("uses the QuoterV2 signature SaucerSwap documents", () => {
    expect(quoterAbi[0].name).toBe("quoteExactInput");
    expect(quoterAbi[0].inputs.map((input) => input.type)).toEqual(["bytes", "uint256"]);
    expect(quoterAbi[0].outputs.map((output) => output.type)).toEqual(["uint256", "uint160[]", "uint32[]", "uint256"]);
  });
});

describe("demo config", () => {
  const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
  const valid = {
    chainId: 31337,
    deployer: addr(1),
    vault: addr(2),
    pyth: addr(3),
    router: addr(4),
    quoter: addr(5),
    minIntervalSeconds: 5,
    poolFee: 3000,
    rates: { good: 500, bad: 400 },
    tokens: {
      in: { address: addr(6), symbol: "mUSDC", decimals: 6 },
      out: { address: addr(7), symbol: "mWHBAR", decimals: 8 },
    },
    priceIds: { in: `0x${"aa".repeat(32)}`, out: `0x${"bb".repeat(32)}` },
  };

  it("accepts a well-formed config", () => {
    expect(parseDemoConfig(valid)?.vault).toBe(addr(2));
  });

  it.each([
    ["null", null],
    ["a string", "nope"],
    ["a bad address", { ...valid, vault: "0x123" }],
    ["a bad feed id", { ...valid, priceIds: { in: "0x12", out: valid.priceIds.out } }],
    ["a missing token", { ...valid, tokens: { in: valid.tokens.in } }],
    ["missing rates", { ...valid, rates: undefined }],
  ])("rejects %s", (_label, input) => {
    expect(parseDemoConfig(input)).toBeNull();
  });
});

describe("local events", () => {
  it("decodes vault logs with block times, newest first, and skips foreign logs", async () => {
    const topics = (planId: bigint) => [...encodeEventTopics({ abi: vaultAbi, eventName: "RunSkipped", args: { planId } })];
    const data = encodeAbiParameters([{ type: "uint8" }], [2]);
    const logs = [
      { topics: topics(1n), data, blockNumber: 5n, transactionHash: "0xaa" },
      { topics: [`0x${"11".repeat(32)}`], data: "0x", blockNumber: 6n, transactionHash: "0xbb" },
      { topics: topics(1n), data, blockNumber: 7n, transactionHash: "0xcc" },
    ];
    const client = {
      getLogs: vi.fn().mockResolvedValue(logs),
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber * 100n })),
    };

    const events = await fetchLocalEvents(client as never, "0x0000000000000000000000000000000000000002");
    expect(events.map((event) => [event.txHash, event.timestamp])).toEqual([
      ["0xcc", 700],
      ["0xaa", 500],
    ]);
    expect(events[0].args).toMatchObject({ planId: 1n, reason: 2 });
  });
});

describe("local network and links", () => {
  it("resolves the offline demo network without exposing it as a real one", () => {
    expect(activeNetworkKey("local")).toBe("local");
    const local = activeNetwork("local");
    expect(local).toMatchObject({ chainId: 31337, explorerUrl: null, mirrorUrl: null, status: "live" });
    expect(vaultAddress("local", "0x1234567890abcdef1234567890abcdef12345678")).toBeNull();
    expect(auditTopicId("local", "0.0.1")).toBeNull();
  });

  it("gives real networks a quoter and Pyth address", () => {
    const testnet = activeNetwork("testnet");
    expect(testnet.quoter).toMatch(/^0x[0-9a-f]{40}$/);
    expect(testnet.pyth).toBe("0xA2aa501b19aff244D90cc15a4Cf739D2725B5729");
  });

  it("builds explorer links only when an explorer exists", () => {
    expect(txLink("https://hashscan.io/testnet", "0xab")).toBe("https://hashscan.io/testnet/transaction/0xab");
    expect(txLink(null, "0xab")).toBeNull();
  });
});
