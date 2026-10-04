interface DemoPanelProps {
  stale: boolean;
  poolBad: boolean;
  busy: boolean;
  onToggleStale: () => void;
  onTogglePool: () => void;
}

/** Local demo only: flip the mock oracle and mock pool to show the price guard saying no. */
export function DemoPanel({ stale, poolBad, busy, onToggleStale, onTogglePool }: DemoPanelProps) {
  return (
    <section className="demo-panel" aria-labelledby="demo-heading">
      <h2 id="demo-heading">Demo controls</h2>
      <p>
        You are on a local demo network with mock contracts. Break the market on purpose, then watch the next scheduled
        purchase get skipped instead of executed.
      </p>
      <div className="actions">
        <button className="btn quiet" disabled={busy} onClick={onToggleStale} aria-pressed={stale}>
          {stale ? "Oracle price is stale: click to fix" : "Make the oracle price stale"}
        </button>
        <button className="btn quiet" disabled={busy} onClick={onTogglePool} aria-pressed={poolBad}>
          {poolBad ? "Pool pays 20% less: click to fix" : "Make the pool pay 20% less"}
        </button>
      </div>
    </section>
  );
}
