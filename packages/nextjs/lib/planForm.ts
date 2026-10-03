import { POOL_FEE_TIERS } from "@auto-dca/config";

export interface PlanFormValues {
  tokenIn: string;
  tokenOut: string;
  fee: string;
  amountPerRun: string;
  runs: string;
  intervalSeconds: string;
  maxSlippagePct: string;
  maxConfPct: string;
  maxPriceAge: string;
  priceIdIn: string;
  priceIdOut: string;
}

export interface PlanInput {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  fee: number;
  amountPerRun: string;
  runs: number;
  intervalSeconds: number;
  maxSlippageBps: number;
  maxConfBps: number;
  maxPriceAge: number;
  priceIdIn: `0x${string}`;
  priceIdOut: `0x${string}`;
}

export type ParseResult = { ok: true; value: PlanInput } | { ok: false; error: string };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const FEED_ID = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^\d+(\.\d+)?$/;

function integerInRange(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

function percentToBps(raw: string, maxPercent: number): number | null {
  if (!DECIMAL.test(raw.trim())) return null;
  const percent = Number(raw);
  return percent >= 0 && percent <= maxPercent ? Math.round(percent * 100) : null;
}

/** Validate the "new plan" form and convert it to contract-ready units. Mirrors the contract's limits. */
export function parsePlanForm(values: PlanFormValues, minIntervalSeconds = 60): ParseResult {
  const tokenIn = values.tokenIn.trim();
  const tokenOut = values.tokenOut.trim();
  if (!ADDRESS.test(tokenIn) || !ADDRESS.test(tokenOut)) {
    return { ok: false, error: "Enter both token addresses as 0x EVM addresses (42 characters)." };
  }
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    return { ok: false, error: "The token you sell and the token you buy must be different." };
  }

  const fee = Number(values.fee);
  if (!POOL_FEE_TIERS.some((tier) => tier.fee === fee)) return { ok: false, error: "Pick a SaucerSwap pool fee tier." };

  const amount = values.amountPerRun.trim();
  if (!DECIMAL.test(amount) || Number(amount) <= 0) {
    return { ok: false, error: "Amount per run must be a number greater than zero." };
  }

  const runs = integerInRange(values.runs, 1, 365);
  if (runs === null) return { ok: false, error: "Runs must be a whole number from 1 to 365." };

  const intervalSeconds = integerInRange(values.intervalSeconds, minIntervalSeconds, 31_536_000);
  if (intervalSeconds === null) {
    return { ok: false, error: `Interval must be at least ${minIntervalSeconds} seconds.` };
  }

  const maxSlippageBps = percentToBps(values.maxSlippagePct, 50);
  if (maxSlippageBps === null) return { ok: false, error: "Max slippage must be between 0% and 50%." };

  const maxConfBps = percentToBps(values.maxConfPct, 100);
  if (maxConfBps === null) return { ok: false, error: "Max price uncertainty must be between 0% and 100%." };

  const maxPriceAge = integerInRange(values.maxPriceAge, 1, 86_400);
  if (maxPriceAge === null) return { ok: false, error: "Max price age must be 1 to 86400 seconds." };

  const priceIdIn = values.priceIdIn.trim();
  const priceIdOut = values.priceIdOut.trim();
  if (!FEED_ID.test(priceIdIn) || !FEED_ID.test(priceIdOut)) {
    return { ok: false, error: "Enter both Pyth price feed IDs (0x followed by 64 hex characters)." };
  }

  return {
    ok: true,
    value: {
      tokenIn: tokenIn as `0x${string}`,
      tokenOut: tokenOut as `0x${string}`,
      fee,
      amountPerRun: amount,
      runs,
      intervalSeconds,
      maxSlippageBps,
      maxConfBps,
      maxPriceAge,
      priceIdIn: priceIdIn as `0x${string}`,
      priceIdOut: priceIdOut as `0x${string}`,
    },
  };
}
