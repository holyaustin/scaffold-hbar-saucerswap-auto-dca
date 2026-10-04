import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { Interface } from "ethers";
import { DEMO_MIN_INTERVAL, DEMO_POOL_FEE, deployDemo, keeperTick, toDemoConfig, type DemoContext, type KeeperState } from "../lib/demo";

async function setup() {
  return deployDemo(hre);
}

async function createPlan(ctx: DemoContext, overrides: Record<string, unknown> = {}) {
  const amount = 10_000_000n;
  const runs = 3;
  const tokenIn = await ctx.usdc.getAddress();
  const tokenOut = await ctx.whbar.getAddress();
  await (await ctx.usdc.approve(await ctx.vault.getAddress(), amount * BigInt(runs))).wait();
  await (
    await ctx.vault.createPlan({
      tokenIn,
      tokenOut,
      path: ethers.solidityPacked(["address", "uint24", "address"], [tokenIn, DEMO_POOL_FEE, tokenOut]),
      amountPerRun: amount,
      runs,
      intervalSeconds: 10,
      maxSlippageBps: 500,
      maxConfBps: 200,
      maxPriceAge: 3600,
      priceIdIn: ethers.id("USDC/USD"),
      priceIdOut: ethers.id("HBAR/USD"),
      ...overrides,
    })
  ).wait();
}

async function advanceToNextRun(ctx: DemoContext) {
  await time.increaseTo((await ctx.vault.getPlan(0)).nextRunAt);
}

describe("offline demo", () => {
  const state = (): KeeperState => ({ fired: new Set(), ticks: 1 });

  it("deploys a working demo world and describes it for the web app", async () => {
    const ctx = await loadFixture(setup);
    const config = await toDemoConfig(hre, ctx);

    expect(config.minIntervalSeconds).to.equal(DEMO_MIN_INTERVAL);
    expect(config.rates).to.deep.equal({ good: 500, bad: 400 });
    expect(config.vault).to.equal(await ctx.vault.getAddress());
    expect(config.tokens.in).to.include({ symbol: "mUSDC", decimals: 6 });
    expect(config.tokens.out).to.include({ symbol: "mWHBAR", decimals: 8 });
    expect(await ctx.usdc.balanceOf(ctx.deployer)).to.equal(1_000_000_000n);
    expect(await ethers.provider.getBalance(config.vault)).to.equal(ethers.parseEther("5"));
  });

  it("runs a plan end to end: the keeper fires each scheduled call exactly once", async () => {
    const ctx = await loadFixture(setup);
    await createPlan(ctx);
    const keeper = state();

    expect(await keeperTick(hre, ctx, keeper)).to.deep.equal([]); // nothing is due yet

    await advanceToNextRun(ctx);
    const [first] = await keeperTick(hre, ctx, keeper);
    expect(first).to.include({ kind: "fired", scheduleIndex: 0 });
    expect(first.message).to.contain("RunExecuted");
    expect(await keeperTick(hre, ctx, keeper)).to.deep.equal([]); // not fired twice

    const plan = await ctx.vault.getPlan(0);
    expect(plan.runsDone).to.equal(1);
    expect(plan.accruedOut).to.equal(5_000_000_000n);

    for (let run = 1; run < 3; run++) {
      await advanceToNextRun(ctx);
      await keeperTick(hre, ctx, keeper);
    }
    expect((await ctx.vault.getPlan(0)).active).to.equal(false);
    expect(await ctx.whbar.balanceOf(await ctx.vault.getAddress())).to.equal(15_000_000_000n);
  });

  it("shows the guard: a stale oracle skips a run, and recovering resumes buying", async () => {
    const ctx = await loadFixture(setup);
    await createPlan(ctx);
    const keeper = state();

    await ctx.pyth.setSimulateStale(true);
    await advanceToNextRun(ctx);
    const [skipped] = await keeperTick(hre, ctx, keeper);
    expect(skipped.message).to.contain("RunSkipped");
    expect((await ctx.vault.getPlan(0)).runsDone).to.equal(0);

    await ctx.pyth.setSimulateStale(false);
    await advanceToNextRun(ctx);
    const [bought] = await keeperTick(hre, ctx, keeper);
    expect(bought.message).to.contain("RunExecuted");
  });

  it("shows the guard: a bad pool price skips the run instead of overpaying", async () => {
    const ctx = await loadFixture(setup);
    await createPlan(ctx);
    const keeper = state();

    await ctx.router.setRate(400, 1); // pool pays 20% less than the oracle implies
    const [, , minimum] = await ctx.vault.previewRun(0);
    const quoted = (await ctx.quoter.quoteExactInput("0x", 10_000_000n))[0] as bigint;
    expect(quoted).to.equal(4_000_000_000n);
    expect(quoted).to.be.lessThan(minimum);

    await advanceToNextRun(ctx);
    const [skipped] = await keeperTick(hre, ctx, keeper);
    expect(skipped.message).to.contain("RunSkipped");
    expect((await ctx.vault.getPlan(0)).fundsRemaining).to.equal(30_000_000n);
  });

  it("the mock quoter matches the router and the real QuoterV2 signature", async () => {
    const ctx = await loadFixture(setup);
    const iface = new Interface([
      "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
    ]);
    const call = iface.encodeFunctionData("quoteExactInput", ["0x", 10_000_000n]);
    const raw = await ethers.provider.call({ to: await ctx.quoter.getAddress(), data: call });
    expect(iface.decodeFunctionResult("quoteExactInput", raw)[0]).to.equal(5_000_000_000n);
  });
});
