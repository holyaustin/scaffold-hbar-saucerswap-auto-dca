"use client";

import type { FormEvent } from "react";
import { POOL_FEE_TIERS } from "@auto-dca/config";
import type { PlanFormValues } from "~/lib/planForm";

/** Prefilled values, used by the local demo so a first plan takes two clicks. */
export type PlanFormDefaults = Partial<Pick<PlanFormValues, "tokenIn" | "tokenOut" | "fee" | "amountPerRun" | "runs" | "priceIdIn" | "priceIdOut">> & {
  intervalSeconds?: number;
};

interface PlanFormProps {
  disabled: boolean;
  busy: boolean;
  /** The vault's shortest allowed interval. Shorter options are hidden. */
  minIntervalSeconds: number;
  defaults?: PlanFormDefaults;
  onSubmit: (values: PlanFormValues) => void;
}

const INTERVALS = [
  { seconds: 10, label: "Every 10 seconds (fast demo)" },
  { seconds: 120, label: "Every 2 minutes (demo)" },
  { seconds: 3600, label: "Every hour" },
  { seconds: 86400, label: "Every day" },
  { seconds: 604800, label: "Every week" },
];

export function PlanForm({ disabled, busy, minIntervalSeconds, defaults = {}, onSubmit }: PlanFormProps) {
  const intervals = INTERVALS.filter((interval) => interval.seconds >= minIntervalSeconds);
  const wanted = defaults.intervalSeconds ?? 120;
  const defaultInterval = (intervals.find((interval) => interval.seconds === wanted) ?? intervals[0])?.seconds ?? wanted;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const read = (name: keyof PlanFormValues) => String(data.get(name) ?? "");
    onSubmit({
      tokenIn: read("tokenIn"),
      tokenOut: read("tokenOut"),
      fee: read("fee"),
      amountPerRun: read("amountPerRun"),
      runs: read("runs"),
      intervalSeconds: read("intervalSeconds"),
      maxSlippagePct: read("maxSlippagePct"),
      maxConfPct: read("maxConfPct"),
      maxPriceAge: read("maxPriceAge"),
      priceIdIn: read("priceIdIn"),
      priceIdOut: read("priceIdOut"),
    });
  }

  return (
    <form className="plan-form" onSubmit={handleSubmit}>
      <label>
        Token to sell
        <input name="tokenIn" placeholder="0x… EVM address" defaultValue={defaults.tokenIn} required spellCheck={false} />
        <span className="hint">An HTS token you hold, e.g. a stablecoin.</span>
      </label>
      <label>
        Token to buy
        <input name="tokenOut" placeholder="0x… EVM address" defaultValue={defaults.tokenOut} required spellCheck={false} />
        <span className="hint">Must share a SaucerSwap V2 pool with the token you sell.</span>
      </label>
      <label>
        Pool fee tier
        <select name="fee" defaultValue={defaults.fee ?? "3000"}>
          {POOL_FEE_TIERS.map((tier) => (
            <option key={tier.fee} value={tier.fee}>
              {tier.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Amount per purchase
        <input name="amountPerRun" inputMode="decimal" defaultValue={defaults.amountPerRun ?? "1"} required />
        <span className="hint">In whole tokens. The full budget is deposited when you start.</span>
      </label>
      <label>
        Number of purchases
        <input name="runs" inputMode="numeric" defaultValue={defaults.runs ?? "3"} required />
      </label>
      <label>
        Schedule
        <select name="intervalSeconds" defaultValue={defaultInterval}>
          {intervals.map((interval) => (
            <option key={interval.seconds} value={interval.seconds}>
              {interval.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Max slippage vs oracle (%)
        <input name="maxSlippagePct" inputMode="decimal" defaultValue="5" required />
        <span className="hint">A purchase is skipped if the pool pays less than this allows.</span>
      </label>
      <label>
        Max price uncertainty (%)
        <input name="maxConfPct" inputMode="decimal" defaultValue="2" required />
      </label>
      <label>
        Max price age (seconds)
        <input name="maxPriceAge" inputMode="numeric" defaultValue="3600" required />
      </label>
      <label className="wide">
        Pyth feed ID for the token you sell (USD)
        <input name="priceIdIn" placeholder="0x… 64 hex characters" defaultValue={defaults.priceIdIn} required spellCheck={false} />
      </label>
      <label className="wide">
        Pyth feed ID for the token you buy (USD)
        <input name="priceIdOut" placeholder="0x… 64 hex characters" defaultValue={defaults.priceIdOut} required spellCheck={false} />
        <span className="hint">
          Find feed IDs in Pyth&apos;s price feed list: docs.pyth.network/price-feeds/core/price-feeds/price-feed-ids
        </span>
      </label>
      <div className="wide">
        <button className="btn" type="submit" disabled={disabled || busy}>
          {busy ? "Working…" : "Deposit and start plan"}
        </button>
      </div>
    </form>
  );
}
