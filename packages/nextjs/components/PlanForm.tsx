"use client";

import type { FormEvent } from "react";
import { POOL_FEE_TIERS } from "@auto-dca/config";
import type { PlanFormValues } from "~/lib/planForm";

interface PlanFormProps {
  disabled: boolean;
  busy: boolean;
  onSubmit: (values: PlanFormValues) => void;
}

const INTERVALS = [
  { seconds: 120, label: "Every 2 minutes (demo)" },
  { seconds: 3600, label: "Every hour" },
  { seconds: 86400, label: "Every day" },
  { seconds: 604800, label: "Every week" },
];

export function PlanForm({ disabled, busy, onSubmit }: PlanFormProps) {
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
        <input name="tokenIn" placeholder="0x… EVM address" required spellCheck={false} />
        <span className="hint">An HTS token you hold, e.g. a stablecoin.</span>
      </label>
      <label>
        Token to buy
        <input name="tokenOut" placeholder="0x… EVM address" required spellCheck={false} />
        <span className="hint">Must share a SaucerSwap V2 pool with the token you sell.</span>
      </label>
      <label>
        Pool fee tier
        <select name="fee" defaultValue="3000">
          {POOL_FEE_TIERS.map((tier) => (
            <option key={tier.fee} value={tier.fee}>
              {tier.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Amount per purchase
        <input name="amountPerRun" inputMode="decimal" defaultValue="1" required />
        <span className="hint">In whole tokens. The full budget is deposited when you start.</span>
      </label>
      <label>
        Number of purchases
        <input name="runs" inputMode="numeric" defaultValue="3" required />
      </label>
      <label>
        Schedule
        <select name="intervalSeconds" defaultValue="120">
          {INTERVALS.map((interval) => (
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
        <input name="priceIdIn" placeholder="0x… 64 hex characters" required spellCheck={false} />
      </label>
      <label className="wide">
        Pyth feed ID for the token you buy (USD)
        <input name="priceIdOut" placeholder="0x… 64 hex characters" required spellCheck={false} />
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
