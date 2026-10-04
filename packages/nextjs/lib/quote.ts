import { formatAmount, skipReasonLabel } from "./format";

/** SaucerSwap QuoterV2. It is read with an `eth_call`, so it costs no gas even though it is not marked `view`. */
export const quoterAbi = [
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96AfterList", type: "uint160[]" },
      { name: "initializedTicksCrossedList", type: "uint32[]" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export interface PoolComparison {
  /** How much less the pool pays than the oracle implies, in basis points. Negative means the pool pays more. */
  gapBps: number;
  /** True when the pool pays at least the plan's floor, so the swap would go through. */
  passes: boolean;
}

export function comparePoolToOracle(poolOut: bigint, expected: bigint, minimum: bigint): PoolComparison {
  const gap = expected === 0n ? 0n : ((expected - poolOut) * 10_000n) / expected;
  return { gapBps: Number(gap), passes: poolOut >= minimum };
}

export interface GuardInput {
  preview: { reason: number; expected: bigint; minimum: bigint };
  /** Pool output for one purchase, or null when no quote could be fetched. */
  quote: bigint | null;
  symbolOut: string;
  decimalsOut: number;
  maxSlippageBps: number;
}

export interface GuardVerdict {
  tone: "go" | "hold";
  text: string;
}

const percent = (bps: number) => `${(Math.abs(bps) / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/** One sentence that says whether the next purchase would run and why, using both the oracle and the live pool. */
export function describeGuard({ preview, quote, symbolOut, decimalsOut, maxSlippageBps }: GuardInput): GuardVerdict {
  if (preview.reason !== 0) {
    return { tone: "hold", text: `Price guard would skip right now: ${skipReasonLabel(preview.reason).toLowerCase()}.` };
  }

  const amount = (raw: bigint) => `${formatAmount(raw, decimalsOut)} ${symbolOut}`;
  if (quote === null) {
    return {
      tone: "go",
      text: `Oracle expects about ${amount(preview.expected)} per purchase and the guard allows no less than ${amount(preview.minimum)}. The live pool quote is not available, so the pool price is only checked when the purchase runs.`,
    };
  }

  const { gapBps, passes } = comparePoolToOracle(quote, preview.expected, preview.minimum);
  if (!passes) {
    return {
      tone: "hold",
      text: `Price guard would skip: the pool pays ${amount(quote)}, ${percent(gapBps)} less than the oracle's ${amount(preview.expected)}. Your limit is ${percent(maxSlippageBps)}.`,
    };
  }
  const relation = gapBps > 0 ? `${percent(gapBps)} under` : gapBps < 0 ? `${percent(gapBps)} over` : "level with";
  return {
    tone: "go",
    text: `Price guard says go: the pool pays ${amount(quote)}, ${relation} the oracle's ${amount(preview.expected)}. Your limit is ${percent(maxSlippageBps)}.`,
  };
}
