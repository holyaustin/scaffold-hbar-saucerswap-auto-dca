import { formatAmount, skipReasonLabel } from "./format";
import type { VaultEvent } from "./mirror";

export interface PlanLabels {
  symbolOut: string;
  decimalsOut: number;
}

export interface ActivityLine {
  key: string;
  text: string;
  txHash: string;
  timestamp: number;
}

/** Events worth showing to a user. Scheduling bookkeeping stays out of the feed. */
const VISIBLE = new Set(["RunExecuted", "RunSkipped", "ScheduleFailed", "PlanPaused", "PlanCompleted"]);

export function describeEvents(events: VaultEvent[], plans: Map<string, PlanLabels>): ActivityLine[] {
  const lines: ActivityLine[] = [];
  events.forEach((event, index) => {
    if (!VISIBLE.has(event.name)) return;
    const planId = event.args.planId as bigint;
    const labels = plans.get(planId.toString());
    if (!labels) return; // another user's plan

    let text: string;
    switch (event.name) {
      case "RunExecuted":
        text = `Bought ${formatAmount(event.args.amountOut as bigint, labels.decimalsOut)} ${labels.symbolOut}`;
        break;
      case "RunSkipped":
        text = `Skipped a purchase: ${skipReasonLabel(Number(event.args.reason)).toLowerCase()}`;
        break;
      case "ScheduleFailed":
        text = "Could not schedule the next purchase. Use Run now when it is due.";
        break;
      case "PlanPaused":
        text = event.args.automatic ? "Paused itself after five skipped purchases in a row" : "Paused";
        break;
      default:
        text = "Finished all purchases";
    }
    lines.push({ key: `${event.txHash}-${index}`, text: `Plan ${planId}: ${text}`, txHash: event.txHash, timestamp: event.timestamp });
  });
  return lines;
}
