import { isAddress } from "viem";

/** Written by `npm run demo:local` to public/demo-config.json. Mirrors the shape in packages/hardhat/lib/demo.ts. */
export interface DemoConfig {
  chainId: number;
  deployer: `0x${string}`;
  vault: `0x${string}`;
  pyth: `0x${string}`;
  router: `0x${string}`;
  quoter: `0x${string}`;
  minIntervalSeconds: number;
  poolFee: number;
  rates: { good: number; bad: number };
  tokens: {
    in: { address: `0x${string}`; symbol: string; decimals: number };
    out: { address: `0x${string}`; symbol: string; decimals: number };
  };
  priceIds: { in: `0x${string}`; out: `0x${string}` };
}

const isFeedId = (value: unknown): value is `0x${string}` => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const isAddr = (value: unknown): value is `0x${string}` => typeof value === "string" && isAddress(value);

function parseToken(raw: unknown): DemoConfig["tokens"]["in"] | null {
  const token = raw as { address?: unknown; symbol?: unknown; decimals?: unknown } | null;
  if (!token || !isAddr(token.address) || typeof token.symbol !== "string" || typeof token.decimals !== "number") return null;
  return { address: token.address, symbol: token.symbol, decimals: token.decimals };
}

/** Validate untrusted JSON before the app trusts it with addresses. Returns null when anything is off. */
export function parseDemoConfig(raw: unknown): DemoConfig | null {
  const c = raw as Record<string, unknown> | null;
  if (!c || typeof c !== "object") return null;
  const tokens = c.tokens as { in?: unknown; out?: unknown } | undefined;
  const tokenIn = parseToken(tokens?.in);
  const tokenOut = parseToken(tokens?.out);
  const ids = c.priceIds as { in?: unknown; out?: unknown } | undefined;
  const rates = c.rates as { good?: unknown; bad?: unknown } | undefined;

  if (
    !isAddr(c.deployer) || !isAddr(c.vault) || !isAddr(c.pyth) || !isAddr(c.router) || !isAddr(c.quoter) ||
    typeof c.chainId !== "number" || typeof c.minIntervalSeconds !== "number" || typeof c.poolFee !== "number" ||
    !tokenIn || !tokenOut || !isFeedId(ids?.in) || !isFeedId(ids?.out) ||
    typeof rates?.good !== "number" || typeof rates?.bad !== "number"
  ) {
    return null;
  }
  return {
    chainId: c.chainId,
    deployer: c.deployer,
    vault: c.vault,
    pyth: c.pyth,
    router: c.router,
    quoter: c.quoter,
    minIntervalSeconds: c.minIntervalSeconds,
    poolFee: c.poolFee,
    rates: { good: rates.good, bad: rates.bad },
    tokens: { in: tokenIn, out: tokenOut },
    priceIds: { in: ids.in, out: ids.out },
  };
}

/** Switches on the demo's mock contracts. They exist only on the local node. */
export const demoControlAbi = [
  { type: "function", name: "simulateStale", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "setSimulateStale", stateMutability: "nonpayable", inputs: [{ name: "stale", type: "bool" }], outputs: [] },
  { type: "function", name: "rateNumerator", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "setRate",
    stateMutability: "nonpayable",
    inputs: [{ name: "numerator", type: "uint256" }, { name: "denominator", type: "uint256" }],
    outputs: [],
  },
] as const;
