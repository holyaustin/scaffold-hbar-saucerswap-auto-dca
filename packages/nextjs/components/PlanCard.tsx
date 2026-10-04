import type { ContractFunctionReturnType } from "viem";
import { formatAmount, formatCountdown, formatInterval } from "~/lib/format";
import { describeGuard } from "~/lib/quote";
import type { vaultAbi } from "~/lib/vaultAbi";
import { CadenceStrip } from "./CadenceStrip";

export type PlanData = ContractFunctionReturnType<typeof vaultAbi, "view", "getPlan">;

export interface PlanView {
  id: bigint;
  plan: PlanData;
  symbolIn: string;
  symbolOut: string;
  preview: { reason: number; expected: bigint; minimum: bigint } | null;
  /** What the live SaucerSwap pool would pay for one purchase, or null when it could not be quoted. */
  quote: bigint | null;
}

export type PlanAction = "pause" | "resume" | "cancel" | "claim" | "run" | "refresh";

interface PlanCardProps {
  view: PlanView;
  now: number;
  busy: boolean;
  /** The local demo keeps its own oracle fresh, so it has no Refresh price button. */
  showRefresh: boolean;
  onAction: (action: PlanAction, id: bigint) => void;
}

function statusOf(plan: PlanData): { text: string; className: string } {
  if (!plan.active) {
    return plan.runsRemaining === 0 && plan.runsDone > 0
      ? { text: "Finished", className: "status done" }
      : { text: "Cancelled", className: "status" };
  }
  if (plan.paused) return { text: "Paused", className: "status paused" };
  return { text: plan.scheduled ? "Scheduled by HSS" : "Waiting for a manual run", className: "status" };
}

export function PlanCard({ view, now, busy, showRefresh, onAction }: PlanCardProps) {
  const { id, plan, symbolIn, symbolOut, preview, quote } = view;
  const verdict =
    preview && plan.active
      ? describeGuard({ preview, quote, symbolOut, decimalsOut: plan.decimalsOut, maxSlippageBps: plan.maxSlippageBps })
      : null;
  const status = statusOf(plan);
  const running = plan.active && !plan.paused;
  const due = running && Number(plan.nextRunAt) <= now;
  const act = (action: PlanAction) => () => onAction(action, id);

  return (
    <article className="plan" aria-label={`Plan ${id}`}>
      <header>
        <h3>
          Plan {id.toString()}: {symbolIn} to {symbolOut}
        </h3>
        <span className={status.className}>{status.text}</span>
      </header>

      <CadenceStrip done={plan.runsDone} remaining={plan.runsRemaining} skipped={plan.runsSkipped} running={running} />

      <dl className="facts">
        <div>
          <dt>Each purchase</dt>
          <dd>
            {formatAmount(plan.amountPerRun, plan.decimalsIn)} {symbolIn} {formatInterval(plan.intervalSeconds)}
          </dd>
        </div>
        <div>
          <dt>Still to spend</dt>
          <dd>
            {formatAmount(plan.fundsRemaining, plan.decimalsIn)} {symbolIn}
          </dd>
        </div>
        <div>
          <dt>Bought, ready to claim</dt>
          <dd>
            {formatAmount(plan.accruedOut, plan.decimalsOut)} {symbolOut}
          </dd>
        </div>
        {running && (
          <div>
            <dt>Next purchase</dt>
            <dd>{formatCountdown(Number(plan.nextRunAt), now)}</dd>
          </div>
        )}
      </dl>

      {verdict && <p className={`guard ${verdict.tone}`}>{verdict.text}</p>}

      <div className="actions">
        {plan.accruedOut > 0n && (
          <button className="btn" disabled={busy} onClick={act("claim")}>
            Claim {symbolOut}
          </button>
        )}
        {plan.active && showRefresh && (
          <button className="btn quiet" disabled={busy} onClick={act("refresh")}>
            Refresh price
          </button>
        )}
        {due && (
          <button className="btn quiet" disabled={busy} onClick={act("run")}>
            Run now
          </button>
        )}
        {running && (
          <button className="btn quiet" disabled={busy} onClick={act("pause")}>
            Pause
          </button>
        )}
        {plan.active && plan.paused && (
          <button className="btn quiet" disabled={busy} onClick={act("resume")}>
            Resume
          </button>
        )}
        {plan.active && (
          <button className="btn danger" disabled={busy} onClick={act("cancel")}>
            Cancel and refund
          </button>
        )}
      </div>
    </article>
  );
}
