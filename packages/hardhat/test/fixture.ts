import { ethers, network } from "hardhat";
import type { Contract, Signer } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SYSTEM_CONTRACTS } from "@auto-dca/config";

/** `contract.connect(signer)` without losing the dynamic method types. */
export const as = (contract: Contract, signer: Signer): Contract => contract.connect(signer) as Contract;

export const ID_USDC = ethers.id("USDC/USD");
export const ID_HBAR = ethers.id("HBAR/USD");

export const GAS_LIMIT = 2_000_000n;
export const MIN_INTERVAL = 60;
export const INTERVAL = 120;
export const RUNS = 3;
export const AMOUNT = 10_000_000n; // 10 USDC (6 decimals)
export const POOL_FEE = 3000;

/** Copy a mock's runtime code to a fixed system-contract address, like a Hedera precompile. */
async function installAt(contractName: string, address: string): Promise<Contract> {
  const factory = await ethers.getContractFactory(contractName);
  const implementation = await factory.deploy();
  await implementation.waitForDeployment();
  const code = await ethers.provider.getCode(await implementation.getAddress());
  await network.provider.send("hardhat_setCode", [address, code]);
  return (await ethers.getContractAt(contractName, address)) as unknown as Contract;
}

export async function deployFixture() {
  const [deployer, alice, bob, keeper] = await ethers.getSigners();

  const hss = await installAt("MockHSS", SYSTEM_CONTRACTS.hss);
  const hts = await installAt("MockHTS", SYSTEM_CONTRACTS.hts);

  // Hardhat returns generic contracts without TypeChain, so we type them as ethers `Contract`.
  const deploy = async (name: string, ...args: unknown[]) =>
    (await (await ethers.getContractFactory(name)).deploy(...args)) as unknown as Contract;

  const usdc = await deploy("MockToken", "USD Coin", "USDC", 6);
  const hbar = await deploy("MockToken", "Wrapped HBAR", "WHBAR", 8);
  const pyth = await deploy("MockPyth");
  const router = await deploy("MockSaucerSwapRouter");
  // 10 USDC at $1.00 buys 50 WHBAR at $0.20, i.e. 500 raw WHBAR per raw USDC.
  await router.setRate(500, 1);

  const vault = await deploy(
    "AutoDcaVault",
    await pyth.getAddress(),
    await router.getAddress(),
    GAS_LIMIT,
    MIN_INTERVAL,
    deployer.address,
  );

  await deployer.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther("5") });
  await usdc.mint(alice.address, AMOUNT * 10n);

  const path = ethers.solidityPacked(
    ["address", "uint24", "address"],
    [await usdc.getAddress(), POOL_FEE, await hbar.getAddress()],
  );

  const fixture = { deployer, alice, bob, keeper, hss, hts, usdc, hbar, pyth, router, vault, path };
  await setPrices(fixture);
  return fixture;
}

export type Fixture = Awaited<ReturnType<typeof deployFixture>>;

/** Publish fresh oracle prices: USDC at $1.00 and WHBAR at $0.20, both +/- $0.0001. */
export async function setPrices({ pyth }: Pick<Fixture, "pyth">, overrides: { conf?: bigint; hbarPrice?: bigint } = {}) {
  const now = await time.latest();
  const conf = overrides.conf ?? 10_000n;
  await pyth.setPrice(ID_USDC, 100_000_000n, conf, -8, now);
  await pyth.setPrice(ID_HBAR, overrides.hbarPrice ?? 20_000_000n, conf, -8, now);
}

export function planParams(fixture: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    tokenIn: fixture.usdc.target,
    tokenOut: fixture.hbar.target,
    path: fixture.path,
    amountPerRun: AMOUNT,
    runs: RUNS,
    intervalSeconds: INTERVAL,
    maxSlippageBps: 500,
    maxConfBps: 200,
    maxPriceAge: 3600,
    priceIdIn: ID_USDC,
    priceIdOut: ID_HBAR,
    ...overrides,
  };
}

/** Approve and create the default plan for Alice. Returns the plan id (always 0 on a fresh fixture). */
export async function createDefaultPlan(fixture: Fixture, overrides: Record<string, unknown> = {}) {
  const params = planParams(fixture, overrides);
  const total = BigInt(params.amountPerRun as bigint) * BigInt(params.runs as number);
  await as(fixture.usdc, fixture.alice).approve(fixture.vault.target, total);
  await as(fixture.vault, fixture.alice).createPlan(params);
  return (await fixture.vault.nextPlanId()) - 1n;
}

/** Move time to the plan's next run, refresh prices, and fire the scheduled call at `index`. */
export async function runDue(fixture: Fixture, planId: bigint, scheduleIndex: number) {
  const plan = await fixture.vault.getPlan(planId);
  await time.increaseTo(plan.nextRunAt);
  await setPrices(fixture);
  return fixture.hss.fire(scheduleIndex);
}
