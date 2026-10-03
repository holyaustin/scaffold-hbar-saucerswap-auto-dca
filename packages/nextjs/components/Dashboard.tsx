"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { encodePacked, parseUnits, type Address, type Hex } from "viem";
import { NETWORKS, isLive, type NetworkKey } from "@auto-dca/config";
import { describeEvents, type ActivityLine } from "~/lib/activity";
import { erc20Abi, hrc719Abi, pythAbi } from "~/lib/erc20Abi";
import { formatAgo, shortAddress, txUrl } from "~/lib/format";
import { fetchVaultEvents } from "~/lib/mirror";
import { parsePlanForm, type PlanFormValues } from "~/lib/planForm";
import { vaultAbi } from "~/lib/vaultAbi";
import {
  GAS,
  TINYBAR_TO_WEIBAR,
  connectWallet,
  describeError,
  injectedProvider,
  publicClientFor,
  walletClientFor,
} from "~/lib/wallet";
import { NetworkSwitch } from "./NetworkSwitch";
import { PlanCard, type PlanAction, type PlanView } from "./PlanCard";
import { PlanForm } from "./PlanForm";

interface Notice {
  kind: "ok" | "error" | "info";
  text: string;
  link?: { href: string; label: string };
}

interface DashboardProps {
  networkKey: NetworkKey;
  vault: Address | null;
  auditTopic: string | null;
}

const POLL_MS = 15_000;

export function Dashboard({ networkKey, vault, auditTopic }: DashboardProps) {
  const network = NETWORKS[networkKey];
  const live = isLive(network);
  const client = useMemo(() => publicClientFor(network), [network]);

  const [account, setAccount] = useState<Address | null>(null);
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [activity, setActivity] = useState<ActivityLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now, setNow] = useState(0);

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
      if (!vault || !live) return;
      const ids = await client.readContract({ address: vault, abi: vaultAbi, functionName: "getPlanIds", args: [owner] });
      const views = await Promise.all(
        [...ids].reverse().map(async (id): Promise<PlanView> => {
          const plan = await client.readContract({ address: vault, abi: vaultAbi, functionName: "getPlan", args: [id] });
          const [symbolIn, symbolOut] = await Promise.all([symbolOf(plan.tokenIn), symbolOf(plan.tokenOut)]);
          const preview = plan.active
            ? await client
                .readContract({ address: vault, abi: vaultAbi, functionName: "previewRun", args: [id] })
                .then(([reason, expected, minimum]) => ({ reason, expected, minimum }))
                .catch(() => null)
            : null;
          return { id, plan, symbolIn, symbolOut, preview };
        }),
      );
      setPlans(views);

      try {
        const labels = new Map(views.map((v) => [v.id.toString(), { symbolOut: v.symbolOut, decimalsOut: v.plan.decimalsOut }]));
        setActivity(describeEvents(await fetchVaultEvents(network.mirrorUrl, vault), labels).slice(0, 12));
      } catch {
        // The mirror node is only used for the activity feed; plan data above still loads without it.
        setActivity([]);
      }
    },
    [client, live, network.mirrorUrl, symbolOf, vault],
  );

  // Clock for countdowns.
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  // Reconnect silently if the wallet already trusts this site.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    (async () => {
      try {
        const accounts = await injectedProvider().request({ method: "eth_accounts" });
        if (!cancelled && accounts[0]) setAccount(accounts[0]);
      } catch {
        // No wallet installed yet: the Connect button explains what to do.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live]);

  // Load and poll plans while connected.
  useEffect(() => {
    if (!account) return;
    const load = () => refresh(account).catch((error) => setNotice({ kind: "error", text: describeError(error) }));
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [account, refresh]);

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

  /** Wait for a transaction and turn a revert into a readable error with a HashScan link. */
  const confirm = useCallback(
    async (hash: Hex) => {
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`The transaction reverted. Open it on HashScan for the reason: ${txUrl(network.explorerUrl, hash)}`);
      }
      return hash;
    },
    [client, network.explorerUrl],
  );

  const connect = () =>
    run("Connect wallet", async () => {
      setAccount(await connectWallet(network));
      return { kind: "info", text: `Connected to ${network.label}.` };
    });

  const createPlan = (values: PlanFormValues) =>
    run("Create plan", async () => {
      if (!vault || !account) throw new Error("Connect your wallet and deploy a vault first.");
      const parsed = parsePlanForm(values);
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
        args: [account, vault],
      });
      if (allowance < total) {
        const approval = await wallet.writeContract({
          account,
          address: input.tokenIn,
          abi: erc20Abi,
          functionName: "approve",
          args: [vault, total],
          gas: GAS.approve,
        });
        await confirm(approval);
      }

      const hash = await wallet.writeContract({
        account,
        address: vault,
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
      return {
        kind: "ok",
        text: "Plan started. The Hedera Schedule Service will run the first purchase on time.",
        link: { href: txUrl(network.explorerUrl, hash), label: "View on HashScan" },
      };
    });

  const handleAction = (action: PlanAction, id: bigint) => {
    const view = plans.find((candidate) => candidate.id === id);
    if (!vault || !account || !view) return;
    const wallet = walletClientFor(network);
    const call = async (functionName: "pausePlan" | "resumePlan" | "cancelPlan" | "claim" | "execute", gas: bigint) =>
      confirm(await wallet.writeContract({ account, address: vault, abi: vaultAbi, functionName, args: [id], gas }));
    const done = (hash: Hex, text: string): Notice => ({ kind: "ok", text, link: { href: txUrl(network.explorerUrl, hash), label: "View on HashScan" } });

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
          // An account must be associated with an HTS token before it can receive it.
          const associated = await client
            .readContract({ address: view.plan.tokenOut, abi: hrc719Abi, functionName: "isAssociated", account })
            .catch(() => false);
          if (!associated) {
            await confirm(
              await wallet.writeContract({
                account,
                address: view.plan.tokenOut,
                abi: hrc719Abi,
                functionName: "associate",
                gas: GAS.associate,
              }),
            );
          }
          return done(await call("claim", GAS.manage), `Claimed ${view.symbolOut} to your wallet.`);
        });
      case "refresh":
        return run("Refresh price", async () => {
          const response = await fetch(`/api/pyth-update?ids=${view.plan.priceIdIn},${view.plan.priceIdOut}`);
          const body = (await response.json()) as { updateData?: Hex[]; error?: string; hint?: string };
          if (!response.ok || !body.updateData) throw new Error(body.hint ?? body.error ?? "Could not fetch a price update.");

          const fee = await client.readContract({
            address: network.pyth as Address,
            abi: pythAbi,
            functionName: "getUpdateFee",
            args: [body.updateData],
          });
          // Send double the fee (converted to weibar); the vault refunds whatever the oracle does not use.
          const hash = await confirm(
            await wallet.writeContract({
              account,
              address: vault,
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

  return (
    <main className="shell">
      <div className="masthead">
        <div>
          <h1>SaucerSwap Auto-DCA</h1>
          <p>Recurring buys on SaucerSwap that schedule themselves on Hedera and skip any purchase the Pyth price guard does not like.</p>
        </div>
        <NetworkSwitch active={networkKey} />
      </div>

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
                Connect wallet
              </button>
              <span className="grow">Connect an EVM wallet to see and create plans.</span>
            </>
          )}
          {vault && (
            <a href={`${network.explorerUrl}/contract/${vault}`} target="_blank" rel="noreferrer">
              Vault {shortAddress(vault)} on HashScan
            </a>
          )}
          {auditTopic && (
            <a href={`${network.explorerUrl}/topic/${auditTopic}`} target="_blank" rel="noreferrer">
              HCS audit trail {auditTopic}
            </a>
          )}
        </div>
      )}

      {live && !vault && (
        <div className="notice" role="status">
          <p>No vault is configured for {network.label} yet.</p>
          <p>Run npm run hardhat:deploy from the repository root, then reload this page.</p>
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

      {live && account && vault && (
        <>
          <section aria-labelledby="plans-heading">
            <h2 id="plans-heading">Your plans</h2>
            {plans.length === 0 ? (
              <p className="empty">No plans yet. Fill in the form below to deposit a budget and start your first one.</p>
            ) : (
              plans.map((view) => (
                <PlanCard key={view.id.toString()} view={view} now={now} busy={busy !== null} onAction={handleAction} />
              ))
            )}
          </section>

          <section aria-labelledby="new-heading">
            <h2 id="new-heading">New plan</h2>
            <PlanForm disabled={!live || !vault} busy={busy === "Create plan"} onSubmit={createPlan} />
          </section>

          <section aria-labelledby="activity-heading">
            <h2 id="activity-heading">Recent activity</h2>
            {activity.length === 0 ? (
              <p className="empty">Purchases and skips appear here once the first scheduled run happens.</p>
            ) : (
              <ul className="activity">
                {activity.map((line) => (
                  <li key={line.key}>
                    <span>{line.text}</span>
                    <span className="time">
                      {formatAgo(line.timestamp, now)}{" "}
                      <a href={txUrl(network.explorerUrl, line.txHash)} target="_blank" rel="noreferrer">
                        HashScan
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
