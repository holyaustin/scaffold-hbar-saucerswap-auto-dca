import { AbiCoder, id, parseEther, type Contract } from "ethers";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { SYSTEM_CONTRACTS } from "@auto-dca/config";

/**
 * Everything the offline demo needs. Mock contracts stand in for the Hedera Schedule Service, the
 * Token Service, Pyth and SaucerSwap, so the whole flow can be shown without a testnet account.
 *
 * The one thing a local node cannot do is run scheduled calls by itself. `keeperTick` plays that part:
 * it fires each scheduled call once its time has come, exactly as the network would.
 */

export const DEMO_MIN_INTERVAL = 5; // seconds, so a full cycle fits in a short recording
export const DEMO_POOL_FEE = 3000;
/** Pool rate in raw tokenOut per raw tokenIn. The bad rate pays 20% less than the oracle implies. */
export const DEMO_RATE_GOOD = 500;
export const DEMO_RATE_BAD = 400;
export const PRICE_ID_USDC = id("USDC/USD");
export const PRICE_ID_HBAR = id("HBAR/USD");

/** Prices are republished this often (in ticks). Longer than a tick so the chain clock tracks real time. */
const PRICE_REFRESH_TICKS = 10;
const PRICE_USDC = 100_000_000n; // $1.00 with expo -8
const PRICE_HBAR = 20_000_000n; // $0.20 with expo -8
const PRICE_CONF = 10_000n;

export interface DemoContext {
  deployer: string;
  vault: Contract;
  pyth: Contract;
  router: Contract;
  quoter: Contract;
  hss: Contract;
  usdc: Contract;
  whbar: Contract;
}

/** What the web app reads from public/demo-config.json. */
export interface DemoConfig {
  chainId: number;
  deployer: string;
  vault: string;
  pyth: string;
  router: string;
  quoter: string;
  minIntervalSeconds: number;
  poolFee: number;
  rates: { good: number; bad: number };
  tokens: {
    in: { address: string; symbol: string; decimals: number };
    out: { address: string; symbol: string; decimals: number };
  };
  priceIds: { in: string; out: string };
  generatedAt: string;
}

export interface KeeperState {
  fired: Set<number>;
  ticks: number;
}

export interface KeeperEvent {
  kind: "fired" | "failed";
  scheduleIndex: number;
  message: string;
}

async function installAt(hre: HardhatRuntimeEnvironment, contractName: string, address: string): Promise<Contract> {
  const { ethers, network } = hre;
  const implementation = await (await ethers.getContractFactory(contractName)).deploy();
  await implementation.waitForDeployment();
  const code = await ethers.provider.getCode(await implementation.getAddress());
  await network.provider.send("hardhat_setCode", [address, code]);
  return (await ethers.getContractAt(contractName, address)) as unknown as Contract;
}

async function chainTime(hre: HardhatRuntimeEnvironment): Promise<number> {
  const block = await hre.ethers.provider.getBlock("latest");
  if (!block) throw new Error("The local node returned no block.");
  return block.timestamp;
}

function priceUpdate(feedId: string, price: bigint, publishTime: number): string {
  return AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "int64", "uint64", "int32", "uint256"],
    [feedId, price, PRICE_CONF, -8, publishTime],
  );
}

/** Publish fresh USDC and HBAR prices in one transaction. */
export async function refreshPrices(hre: HardhatRuntimeEnvironment, pyth: Contract): Promise<void> {
  const now = await chainTime(hre);
  const payloads = [priceUpdate(PRICE_ID_USDC, PRICE_USDC, now), priceUpdate(PRICE_ID_HBAR, PRICE_HBAR, now)];
  const fee = (await pyth.getUpdateFee(payloads)) as bigint;
  await (await pyth.updatePriceFeeds(payloads, { value: fee })).wait();
}

export async function deployDemo(hre: HardhatRuntimeEnvironment): Promise<DemoContext> {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();

  const hss = await installAt(hre, "MockHSS", SYSTEM_CONTRACTS.hss);
  await installAt(hre, "MockHTS", SYSTEM_CONTRACTS.hts);

  const deploy = async (name: string, ...args: unknown[]) => {
    const contract = await (await ethers.getContractFactory(name)).deploy(...args);
    await contract.waitForDeployment();
    return contract as unknown as Contract;
  };

  const usdc = await deploy("MockToken", "Demo USDC", "mUSDC", 6);
  const whbar = await deploy("MockToken", "Demo WHBAR", "mWHBAR", 8);
  const pyth = await deploy("MockPyth");
  const router = await deploy("MockSaucerSwapRouter");
  const quoter = await deploy("MockSaucerSwapQuoter", await router.getAddress());
  // 10 USDC at $1.00 buys 50 WHBAR at $0.20: 500 raw WHBAR per raw USDC.
  await (await router.setRate(DEMO_RATE_GOOD, 1)).wait();

  const vault = await deploy(
    "AutoDcaVault",
    await pyth.getAddress(),
    await router.getAddress(),
    2_000_000n,
    DEMO_MIN_INTERVAL,
    deployer.address,
  );
  await (await deployer.sendTransaction({ to: await vault.getAddress(), value: parseEther("5") })).wait();
  await (await usdc.mint(deployer.address, 1_000n * 10n ** 6n)).wait();
  await refreshPrices(hre, pyth);

  return { deployer: deployer.address, vault, pyth, router, quoter, hss, usdc, whbar };
}

export async function toDemoConfig(hre: HardhatRuntimeEnvironment, ctx: DemoContext): Promise<DemoConfig> {
  const network = await hre.ethers.provider.getNetwork();
  return {
    chainId: Number(network.chainId),
    deployer: ctx.deployer,
    vault: await ctx.vault.getAddress(),
    pyth: await ctx.pyth.getAddress(),
    router: await ctx.router.getAddress(),
    quoter: await ctx.quoter.getAddress(),
    minIntervalSeconds: DEMO_MIN_INTERVAL,
    poolFee: DEMO_POOL_FEE,
    rates: { good: DEMO_RATE_GOOD, bad: DEMO_RATE_BAD },
    tokens: {
      in: { address: await ctx.usdc.getAddress(), symbol: "mUSDC", decimals: 6 },
      out: { address: await ctx.whbar.getAddress(), symbol: "mWHBAR", decimals: 8 },
    },
    priceIds: { in: PRICE_ID_USDC, out: PRICE_ID_HBAR },
    generatedAt: new Date().toISOString(),
  };
}

function describeVaultLogs(ctx: DemoContext, logs: ReadonlyArray<{ topics: ReadonlyArray<string>; data: string }>): string {
  const names = logs
    .map((log) => ctx.vault.interface.parseLog({ topics: [...log.topics], data: log.data }))
    .filter((parsed) => parsed !== null && ["RunExecuted", "RunSkipped", "PlanPaused", "PlanCompleted", "ScheduleFailed"].includes(parsed.name))
    .map((parsed) => `${parsed!.name} (plan ${parsed!.args[0]})`);
  return names.length > 0 ? names.join(", ") : "no plan events";
}

/**
 * One beat of the emulated Schedule Service. Keeps the oracle fresh, keeps the chain clock moving, and
 * fires every scheduled call whose time has arrived (once). Call it about once a second.
 */
export async function keeperTick(hre: HardhatRuntimeEnvironment, ctx: DemoContext, state: KeeperState): Promise<KeeperEvent[]> {
  // Publishing prices mines a block, so it also moves the clock. On other ticks mine an empty block.
  if (state.ticks % PRICE_REFRESH_TICKS === 0) await refreshPrices(hre, ctx.pyth);
  else await hre.network.provider.send("evm_mine");
  state.ticks += 1;

  const now = await chainTime(hre);
  const events: KeeperEvent[] = [];
  const total = Number(await ctx.hss.count());

  for (let index = 0; index < total; index++) {
    if (state.fired.has(index)) continue;
    const [, expirySecond] = (await ctx.hss.scheduledAt(index)) as [string, bigint];
    if (Number(expirySecond) > now) continue;

    state.fired.add(index);
    try {
      const receipt = await (await ctx.hss.fire(index, { gasLimit: 3_000_000 })).wait();
      events.push({ kind: "fired", scheduleIndex: index, message: describeVaultLogs(ctx, receipt?.logs ?? []) });
    } catch (error) {
      const reason = error instanceof Error ? error.message.split("\n")[0] : "unknown error";
      events.push({ kind: "failed", scheduleIndex: index, message: reason });
    }
  }
  return events;
}
