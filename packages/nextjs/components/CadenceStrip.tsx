interface CadenceStripProps {
  done: number;
  remaining: number;
  skipped: number;
  running: boolean;
}

/** One dot per planned purchase: filled when bought, ringed for the next one, empty while upcoming. */
export function CadenceStrip({ done, remaining, skipped, running }: CadenceStripProps) {
  const total = done + remaining;
  return (
    <>
      <div className="cadence" role="img" aria-label={`${done} of ${total} purchases done, ${remaining} to go`}>
        {Array.from({ length: total }, (_, index) => {
          const isDone = index < done;
          const isNext = index === done && running;
          const classes = ["tick", isDone ? "done" : "", isNext ? "next pulse" : ""].filter(Boolean).join(" ");
          return <span key={index} className={classes} />;
        })}
      </div>
      <p className="cadence-note">
        {done} of {total} bought
        {skipped > 0 && (
          <>
            {" "}
            <span className="skipped">{skipped} skipped by the price guard</span>
          </>
        )}
      </p>
    </>
  );
}
