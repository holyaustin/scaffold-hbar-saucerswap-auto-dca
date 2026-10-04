"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { encodePacked, parseUnits, type Address, type Hex } from "viem";
import { describeEvents, type ActivityLine } from "~/lib/activity";
import { demoControlAbi, parseDemoConfig, type DemoConfig } from "~/lib/demo";
import { erc20Abi, hrc719Abi, pythAbi } from "~/lib/erc20Abi";
import { formatAgo, shortAddress, txLink } from "~/lib/format";
import { fetchLocalEvents } from "~/lib/localEvents";
import { fetchVaultEvents, type VaultEvent } from "~/lib/mirror";
import { activeNetwork, canTransact, type ChainKey } from "~/lib/networks";
import { parsePlanForm, type PlanFormValues } from "~/lib/planForm";
import { quoterAbi } from "~/lib/quote";
import { vaultAbi } from "~/lib/vaultAbi";
import {
  GAS,
  TINYBAR_TO_WEIBAR,
  approvedAccounts,
  connectWallet,
  describeError,
  publicClientFor,
  walletClientFor,
} from "~/lib/wallet";
import { DemoPanel } from "./DemoPanel";
import { NetworkSwitch } from "./NetworkSwitch";
import { PlanCard, type PlanAction, type PlanView } from "./PlanCard";
import { PlanForm, type PlanFormDefaults } from "./PlanForm";

interface Notice {
  kind: "ok" | "error" | "info";
  text: string;
  link?: { href: string; label: string };
}

interface DashboardProps {
  networkKey: ChainKey;
  vault: Address | null;
  auditTopic: string | null;
}

const POLL_MS = 15_000;
const LOCAL_POLL_MS = 3_000;

export function Dashboard({ networkKey, vault, auditTopic }: DashboardProps) {
  const network = useMemo(() => activeNetwork(networkKey), [networkKey]);
  const isLocal = network.key === "local";
  const live = canTransact(network);
  const client = useMemo(() => publicClientFor(network), [network]);

  const [demo, setDemo] = useState<DemoConfig | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [activity, setActivity] = useState<ActivityLine[]>([]);
  const [minInterval, setMinInterval] = useState(60);
  const [demoState, setDemoState] = useState({ stale: false, poolBad: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now, setNow] = useState(0);

  // The local demo deploys fresh contracts on every start, so its addresses arrive at runtime.
  const vaultAddr = isLocal ? (demo?.vault ?? null) : vault;
  const quoterAddr = isLocal ? (demo?.quoter ?? null) : network.quoter;

  const symbolOf = useCallback(
    async (token: Address) => {
      try {
        return await client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" });
      } catch {
        return shortAddress(token);
      }
    },
    [client],
  );

  const refresh = useCallback(
    async (owner: Address) => {
      if (!vaultAddr || !live) return;
      const ids = await client.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "getPlanIds", args: [owner] });
      const views = await Promise.all(
        [...ids].reverse().map(async (id): Promise<PlanView> => {
          const plan = await client.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "getPlan", args: [id] });
          const [symbolIn, symbolOut] = await Promise.all([symbolOf(plan.tokenIn), symbolOf(plan.tokenOut)]);
          const preview = plan.active
            ? await client
                .readContract({ address: vaultAddr, abi: vaultAbi, functionName: "previewRun", args: [id] })
                .then(([reason, expected, minimum]) => ({ reason, expected, minimum }))
                .catch(() => null)
            : null;
          // Ask SaucerSwap what the pool would pay right now. This is an eth_call, so it costs no gas.
          const quote =
            plan.active && quoterAddr
              ? await client
                  .simulateContract({ address: quoterAddr, abi: quoterAbi, functionName: "quoteExactInput", args: [plan.path, plan.amountPerRun] })
                  .then((simulated) => simulated.result[0])
                  .catch(() => null)
              : null;
          return { id, plan, symbolIn, symbolOut, preview, quote };
        }),
      );
      setPlans(views);

      if (isLocal && demo) {
        const [stale, rate] = await Promise.all([
          client.readContract({ address: demo.pyth, abi: demoControlAbi, functionName: "simulateStale" }),
          client.readContract({ address: demo.router, abi: demoControlAbi, functionName: "rateNumerator" }),
        ]);
        setDemoState({ stale, poolBad: rate !== BigInt(demo.rates.good) });
      }

      try {
        const events: VaultEvent[] = isLocal
          ? await fetchLocalEvents({ getLogs: (args) => client.getLogs(args), getBlock: (args) => client.getBlock(args) }, vaultAddr)
          : network.mirrorUrl
            ? await fetchVaultEvents(network.mirrorUrl, vaultAddr)
            : [];
        const labels = new Map(views.map((v) => [v.id.toString(), { symbolOut: v.symbolOut, decimalsOut: v.plan.decimalsOut }]));
        setActivity(describeEvents(events, labels).slice(0, 12));
      } catch {
        // The activity feed is a convenience; plan data above still loads without it.
        setActivity([]);
      }
    },
    [client, demo, isLocal, live, network.mirrorUrl, quoterAddr, symbolOf, vaultAddr],
  );

  // Clock for countdowns.
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  // Local demo: pick up the addresses the demo wrote once it finishes deploying.
  useEffect(() => {
    if (!isLocal) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/demo-config.json", { cache: "no-store" });
        const parsed = response.ok ? parseDemoConfig(await response.json()) : null;
        if (!cancelled && parsed) setDemo((previous) => (JSON.stringify(previous) === JSON.stringify(parsed) ? previous : parsed));
      } catch {
        // Not written yet. Keep waiting.
      }
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isLocal]);

  // The vault knows its own shortest allowed interval.
  useEffect(() => {
    if (!vaultAddr) return;
    client
      .readContract({ address: vaultAddr, abi: vaultAbi, functionName: "minIntervalSeconds" })
      .then((seconds) => setMinInterval(Number(seconds)))
      .catch(() => undefined);
  }, [client, vaultAddr]);

  // Reconnect silently if the wallet already trusts this site (the local demo connects itself).
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    (async () => {
      try {
        const [first] = await approvedAccounts(network);
        if (!cancelled && first) setAccount(first);
      } catch {
        // No wallet installed yet: the Connect button explains what to do.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live, network]);

  // Load and poll plans while connected.
  useEffect(() => {
    if (!account) return;
    const load = () => refresh(account).catch((error) => setNotice({ kind: "error", text: describeError(error) }));
    load();
    const timer = setInterval(load, isLocal ? LOCAL_POLL_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [account, isLocal, refresh]);

  const run = useCallback(
    async (label: string, task: () => Promise<Notice | void>) => {
      setBusy(label);
      setNotice(null);
      try {
        const result = await task();
        setNotice(result ?? { kind: "ok", text: `${label} complete.` });
        if (account) await refresh(account);
      } catch (error) {
        setNotice({ kind: "error", text: describeError(error) });
      } finally {
        setBusy(null);
      }
    },
    [account, refresh],
  );

  /** Wait for a transaction and turn a revert into a readable error. */
  const confirm = useCallback(
    async (hash: Hex) => {
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        const link = txLink(network.explorerUrl, hash);
        throw new Error(`The transaction reverted.${link ? ` Open it on HashScan for the reason: ${link}` : ` Hash: ${hash}`}`);
      }
      return hash;
    },
    [client, network.explorerUrl],
  );

  const done = (hash: Hex, text: string): Notice => {
    const href = txLink(network.explorerUrl, hash);
    return { kind: "ok", text, ...(href ? { link: { href, label: "View on HashScan" } } : {}) };
  };

  const connect = () =>
    run("Connect wallet", async () => {
      setAccount(await connectWallet(network));
      return { kind: "info", text: `Connected to ${network.label}.` };
    });

  const createPlan = (values: PlanFormValues) =>
    run("Create plan", async () => {
      if (!vaultAddr || !account) throw new Error("Connect your wallet and deploy a vault first.");
      const parsed = parsePlanForm(values, minInterval);
      if (!parsed.ok) throw new Error(parsed.error);
      const input = parsed.value;
      const wallet = walletClientFor(network);

      const decimals = await client.readContract({ address: input.tokenIn, abi: erc20Abi, functionName: "decimals" });
      const amountPerRun = parseUnits(input.amountPerRun, decimals);
      const total = amountPerRun * BigInt(input.runs);

      const allowance = await client.readContract({
        address: input.tokenIn,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, vaultAddr],
      });
      if (allowance < total) {
        const approval = await wallet.writeContract({
          account,
          address: input.tokenIn,
          abi: erc20Abi,
          functionName: "approve",
          args: [vaultAddr, total],
          gas: GAS.approve,
        });
        await confirm(approval);
      }

      const hash = await wallet.writeContract({
        account,
        address: vaultAddr,
        abi: vaultAbi,
        functionName: "createPlan",
        args: [
          {
            tokenIn: input.tokenIn,
            tokenOut: input.tokenOut,
            path: encodePacked(["address", "uint24", "address"], [input.tokenIn, input.fee, input.tokenOut]),
            amountPerRun,
            runs: input.runs,
            intervalSeconds: input.intervalSeconds,
            maxSlippageBps: input.maxSlippageBps,
            maxConfBps: input.maxConfBps,
            maxPriceAge: input.maxPriceAge,
            priceIdIn: input.priceIdIn,
            priceIdOut: input.priceIdOut,
          },
        ],
        gas: GAS.createPlan,
      });
      await confirm(hash);
      return done(hash, "Plan started. The Schedule Service will run the first purchase on time.");
    });

  const handleAction = (action: PlanAction, id: bigint) => {
    const view = plans.find((candidate) => candidate.id === id);
    if (!vaultAddr || !account || !view) return;
    const wallet = walletClientFor(network);
    const call = async (functionName: "pausePlan" | "resumePlan" | "cancelPlan" | "claim" | "execute", gas: bigint) =>
      confirm(await wallet.writeContract({ account, address: vaultAddr, abi: vaultAbi, functionName, args: [id], gas }));

    switch (action) {
      case "pause":
        return run("Pause", async () => done(await call("pausePlan", GAS.manage), "Plan paused."));
      case "resume":
        return run("Resume", async () => done(await call("resumePlan", GAS.createPlan), "Plan resumed and rescheduled."));
      case "cancel":
        return run("Cancel", async () => done(await call("cancelPlan", GAS.manage), "Plan cancelled. Unspent funds are back in your wallet."));
      case "run":
        return run("Run now", async () => done(await call("execute", GAS.execute), "Run submitted. Check the activity feed for the result."));
      case "claim":
        return run("Claim", async () => {
          // On Hedera an account must be associated with an HTS token before it can receive it.
          // The local demo uses plain ERC-20 mocks, which have no such step.
          if (!isLocal) {
            const associated = await client
              .readContract({ address: view.plan.tokenOut, abi: hrc719Abi, functionName: "isAssociated", account })
              .catch(() => false);
            if (!associated) {
              await confirm(
                await wallet.writeContract({ account, address: view.plan.tokenOut, abi: hrc719Abi, functionName: "associate", gas: GAS.associate }),
              );
            }
          }
          return done(await call("claim", GAS.manage), `Claimed ${view.symbolOut} to your wallet.`);
        });
      case "refresh":
        return run("Refresh price", async () => {
          if (!network.pyth) throw new Error("Price refresh is not available on this network.");
          const response = await fetch(`/api/pyth-update?ids=${view.plan.priceIdIn},${view.plan.priceIdOut}`);
          const body = (await response.json()) as { updateData?: Hex[]; error?: string; hint?: string };
          if (!response.ok || !body.updateData) throw new Error(body.hint ?? body.error ?? "Could not fetch a price update.");

          const fee = await client.readContract({ address: network.pyth, abi: pythAbi, functionName: "getUpdateFee", args: [body.updateData] });
          // Send double the fee (converted to weibar); the vault refunds whatever the oracle does not use.
          const hash = await confirm(
            await wallet.writeContract({
              account,
              address: vaultAddr,
              abi: vaultAbi,
              functionName: "refreshPrice",
              args: [body.updateData],
              value: fee * TINYBAR_TO_WEIBAR * 2n,
              gas: GAS.refreshPrice,
            }),
          );
          return done(hash, "Fresh Pyth price pushed on-chain.");
        });
    }
  };

  const toggleStale = () =>
    run("Oracle switch", async () => {
      if (!demo || !account) throw new Error("The demo is not ready yet.");
      const stale = !demoState.stale;
      await confirm(
        await walletClientFor(network).writeContract({ account, address: demo.pyth, abi: demoControlAbi, functionName: "setSimulateStale", args: [stale], gas: GAS.manage }),
      );
      return { kind: "info", text: stale ? "The oracle price is now stale. The next purchase will be skipped." : "The oracle price is fresh again." };
    });

  const togglePool = () =>
    run("Pool switch", async () => {
      if (!demo || !account) throw new Error("The demo is not ready yet.");
      const poolBad = !demoState.poolBad;
      await confirm(
        await walletClientFor(network).writeContract({
          account,
          address: demo.router,
          abi: demoControlAbi,
          functionName: "setRate",
          args: [BigInt(poolBad ? demo.rates.bad : demo.rates.good), 1n],
          gas: GAS.manage,
        }),
      );
      return { kind: "info", text: poolBad ? "The pool now pays 20% less than the oracle implies. The next purchase will be skipped." : "The pool price is back in line with the oracle." };
    });

  const formDefaults: PlanFormDefaults | undefined = demo
    ? {
        tokenIn: demo.tokens.in.address,
        tokenOut: demo.tokens.out.address,
        fee: String(demo.poolFee),
        amountPerRun: "10",
        runs: "3",
        intervalSeconds: 10,
        priceIdIn: demo.priceIds.in,
        priceIdOut: demo.priceIds.out,
      }
    : undefined;

  return (
    <main className="shell">
      <div className="masthead">
        <div>
          <h1>SaucerSwap Auto-DCA</h1>
          <p>Recurring buys on SaucerSwap that schedule themselves on Hedera and skip any purchase the Pyth price guard does not like.</p>
        </div>
        {!isLocal && <NetworkSwitch active={networkKey as "testnet" | "mainnet"} />}
      </div>

      {isLocal && (
        <div className="notice" role="status">
          <p>Local demo. No wallet, testnet account or HBAR needed.</p>
          <p>The contracts are mocks, and a local scheduler plays the part of the Hedera Schedule Service. On Hedera the network does that itself.</p>
        </div>
      )}

      {!live && (
        <div className="notice" role="status">
          <p>{network.label} is coming soon.</p>
          <p>Plans can only be created on Hedera testnet for now. Set NEXT_PUBLIC_HEDERA_NETWORK=testnet to use the app.</p>
        </div>
      )}

      {live && (
        <div className="bar">
          {account ? (
            <span className="grow">
              Connected as {shortAddress(account)} on {network.label}
            </span>
          ) : (
            <>
              <button className="btn" onClick={connect} disabled={busy !== null}>
                {isLocal ? "Connect demo account" : "Connect wallet"}
              </button>
              <span className="grow">{isLocal ? "Uses a built-in test account on the local node." : "Connect an EVM wallet to see and create plans."}</span>
            </>
          )}
          {vaultAddr && network.explorerUrl && (
            <a href={`${network.explorerUrl}/contract/${vaultAddr}`} target="_blank" rel="noreferrer">
              Vault {shortAddress(vaultAddr)} on HashScan
            </a>
          )}
          {auditTopic && network.explorerUrl && (
            <a href={`${network.explorerUrl}/topic/${auditTopic}`} target="_blank" rel="noreferrer">
              HCS audit trail {auditTopic}
            </a>
          )}
        </div>
      )}

      {live && !vaultAddr && (
        <div className="notice" role="status">
          {isLocal ? (
            <>
              <p>Waiting for the demo to finish deploying.</p>
              <p>If this does not change in a few seconds, check the [scheduler] output in the terminal running npm run demo:local.</p>
            </>
          ) : (
            <>
              <p>No vault is configured for {network.label} yet.</p>
              <p>Run npm run hardhat:deploy from the repository root, then reload this page.</p>
            </>
          )}
        </div>
      )}

      {notice && (
        <div className={`notice ${notice.kind === "info" ? "" : notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <p>{notice.text}</p>
          {notice.link && (
            <p>
              <a href={notice.link.href} target="_blank" rel="noreferrer">
                {notice.link.label}
              </a>
            </p>
          )}
        </div>
      )}

      {live && account && vaultAddr && (
        <>
          {isLocal && demo && (
            <DemoPanel
              stale={demoState.stale}
              poolBad={demoState.poolBad}
              busy={busy !== null}
              onToggleStale={toggleStale}
              onTogglePool={togglePool}
            />
          )}

          <section aria-labelledby="plans-heading">
            <h2 id="plans-heading">Your plans</h2>
            {plans.length === 0 ? (
              <p className="empty">No plans yet. Fill in the form below to deposit a budget and start your first one.</p>
            ) : (
              plans.map((view) => (
                <PlanCard
                  key={view.id.toString()}
                  view={view}
                  now={now}
                  busy={busy !== null}
                  showRefresh={!isLocal}
                  onAction={handleAction}
                />
              ))
            )}
          </section>

          <section aria-labelledby="new-heading">
            <h2 id="new-heading">New plan</h2>
            <PlanForm
              key={vaultAddr}
              disabled={!live}
              busy={busy === "Create plan"}
              minIntervalSeconds={minInterval}
              defaults={formDefaults}
              onSubmit={createPlan}
            />
          </section>

          <section aria-labelledby="activity-heading">
            <h2 id="activity-heading">Recent activity</h2>
            {activity.length === 0 ? (
              <p className="empty">Purchases and skips appear here once the first scheduled run happens.</p>
            ) : (
              <ul className="activity">
                {activity.map((line) => {
                  const href = txLink(network.explorerUrl, line.txHash);
                  return (
                    <li key={line.key}>
                      <span>{line.text}</span>
                      <span className="time">
                        {formatAgo(line.timestamp, now)}{" "}
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer">
                            HashScan
                          </a>
                        ) : (
                          shortAddress(line.txHash)
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
