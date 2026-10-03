import { NETWORKS, isLive, type NetworkKey } from "@auto-dca/config";

/** Both networks are listed. Anything that is not live is visibly unavailable and cannot be selected. */
export function NetworkSwitch({ active }: { active: NetworkKey }) {
  return (
    <div className="switch" role="group" aria-label="Hedera network">
      {Object.values(NETWORKS).map((network) => {
        const live = isLive(network);
        return (
          <button
            key={network.key}
            type="button"
            aria-pressed={network.key === active && live}
            aria-disabled={!live}
            onClick={(event) => event.preventDefault()}
          >
            {network.key === "testnet" ? "Testnet" : "Mainnet"}
            {!live && <span className="soon">Coming soon</span>}
          </button>
        );
      })}
    </div>
  );
}
