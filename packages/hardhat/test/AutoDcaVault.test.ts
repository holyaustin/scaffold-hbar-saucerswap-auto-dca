import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  AMOUNT,
  as,
  GAS_LIMIT,
  ID_HBAR,
  INTERVAL,
  RUNS,
  createDefaultPlan,
  deployFixture,
  planParams,
  runDue,
  setPrices,
} from "./fixture";

const SkipReason = { None: 0, StalePrice: 1, LowConfidence: 2, InvalidPrice: 3, SwapFailed: 4 } as const;

describe("AutoDcaVault", () => {
  describe("createPlan", () => {
    it("pulls the full budget, associates both tokens and stores the plan", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);

      expect(await f.usdc.balanceOf(f.vault.target)).to.equal(AMOUNT * BigInt(RUNS));
      expect(await f.hts.isAssociated(f.vault.target, f.usdc.target)).to.equal(true);
      expect(await f.hts.isAssociated(f.vault.target, f.hbar.target)).to.equal(true);

      const plan = await f.vault.getPlan(0);
      expect(plan.owner).to.equal(f.alice.address);
      expect(plan.active).to.equal(true);
      expect(plan.decimalsIn).to.equal(6);
      expect(plan.decimalsOut).to.equal(8);
      expect(plan.fundsRemaining).to.equal(AMOUNT * BigInt(RUNS));
      expect(await f.vault.getPlanIds(f.alice.address)).to.deep.equal([0n]);
    });

    it("schedules its own next run through HSS", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);

      expect(await f.hss.count()).to.equal(1);
      const [to, expiry, gasLimit, callData] = await f.hss.scheduledAt(0);
      const plan = await f.vault.getPlan(0);
      expect(to).to.equal(f.vault.target);
      expect(expiry).to.equal(plan.nextRunAt);
      expect(gasLimit).to.equal(GAS_LIMIT);
      expect(callData).to.equal(f.vault.interface.encodeFunctionData("execute", [0]));
      expect(plan.scheduled).to.equal(true);
      expect(plan.nextRunAt).to.equal(BigInt(await time.latest()) + BigInt(INTERVAL));
    });

    it("moves to the next second when HSS reports a busy second", async () => {
      const f = await loadFixture(deployFixture);
      await as(f.usdc, f.alice).approve(f.vault.target, AMOUNT * BigInt(RUNS));

      // Pin the block time so the second we mark busy is exactly the one the vault asks for first.
      const createdAt = (await time.latest()) + 10;
      await time.setNextBlockTimestamp(createdAt);
      await f.hss.setBusy(createdAt + INTERVAL, true);
      await as(f.vault, f.alice).createPlan(planParams(f));

      const plan = await f.vault.getPlan(0);
      expect(plan.nextRunAt).to.equal(createdAt + INTERVAL + 1);
      expect(plan.scheduled).to.equal(true);
    });

    it("stays usable when HSS refuses to schedule", async () => {
      const f = await loadFixture(deployFixture);
      await f.hss.setFailScheduling(true);
      const params = planParams(f);
      await as(f.usdc, f.alice).approve(f.vault.target, AMOUNT * BigInt(RUNS));

      await expect(as(f.vault, f.alice).createPlan(params))
        .to.emit(f.vault, "ScheduleFailed")
        .withArgs(0, 366);
      const plan = await f.vault.getPlan(0);
      expect(plan.active).to.equal(true);
      expect(plan.scheduled).to.equal(false);
    });

    it("rejects invalid input", async () => {
      const f = await loadFixture(deployFixture);
      const vault = as(f.vault, f.alice);
      await as(f.usdc, f.alice).approve(f.vault.target, AMOUNT * 10n);
      const wrongPath = ethers.solidityPacked(
        ["address", "uint24", "address"],
        [f.hbar.target, 3000, f.usdc.target],
      );

      await expect(vault.createPlan(planParams(f, { tokenOut: f.usdc.target }))).to.be.revertedWithCustomError(
        f.vault,
        "InvalidTokens",
      );
      await expect(vault.createPlan(planParams(f, { runs: 0 }))).to.be.revertedWithCustomError(
        f.vault,
        "InvalidAmounts",
      );
      await expect(vault.createPlan(planParams(f, { amountPerRun: 0 }))).to.be.revertedWithCustomError(
        f.vault,
        "InvalidAmounts",
      );
      await expect(vault.createPlan(planParams(f, { intervalSeconds: 10 })))
        .to.be.revertedWithCustomError(f.vault, "IntervalTooShort")
        .withArgs(10, 60);
      await expect(vault.createPlan(planParams(f, { maxSlippageBps: 6000 }))).to.be.revertedWithCustomError(
        f.vault,
        "InvalidPolicy",
      );
      await expect(vault.createPlan(planParams(f, { maxPriceAge: 0 }))).to.be.revertedWithCustomError(
        f.vault,
        "InvalidPolicy",
      );
      await expect(vault.createPlan(planParams(f, { path: "0x1234" }))).to.be.revertedWithCustomError(
        f.vault,
        "InvalidPath",
      );
      await expect(vault.createPlan(planParams(f, { path: wrongPath }))).to.be.revertedWithCustomError(
        f.vault,
        "InvalidPath",
      );
    });

    it("reverts when HTS association fails", async () => {
      const f = await loadFixture(deployFixture);
      await f.hts.setFailAssociation(true);
      await as(f.usdc, f.alice).approve(f.vault.target, AMOUNT * BigInt(RUNS));
      await expect(as(f.vault, f.alice).createPlan(planParams(f)))
        .to.be.revertedWithCustomError(f.vault, "AssociationFailed")
        .withArgs(f.usdc.target, 167);
    });
  });

  describe("execute", () => {
    it("swaps, accounts for the run and reschedules", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);

      await expect(runDue(f, 0n, 0)).to.emit(f.vault, "RunExecuted").withArgs(0, AMOUNT, 5_000_000_000n, 5_000_000_000n, RUNS - 1);

      const plan = await f.vault.getPlan(0);
      expect(plan.runsDone).to.equal(1);
      expect(plan.runsRemaining).to.equal(RUNS - 1);
      expect(plan.fundsRemaining).to.equal(AMOUNT * BigInt(RUNS - 1));
      expect(plan.accruedOut).to.equal(5_000_000_000n);
      expect(await f.hss.count()).to.equal(2);
      expect(await f.usdc.allowance(f.vault.target, f.router.target)).to.equal(0);
    });

    it("lets anyone run a due plan but not an early one", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);

      await expect(as(f.vault, f.keeper).execute(0)).to.be.revertedWithCustomError(f.vault, "NotDue");

      const plan = await f.vault.getPlan(0);
      await time.increaseTo(plan.nextRunAt);
      await setPrices(f);
      await expect(as(f.vault, f.keeper).execute(0)).to.emit(f.vault, "RunExecuted");
    });

    it("completes after the last run and stops scheduling", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);

      for (let run = 0; run < RUNS; run++) await runDue(f, 0n, run);

      const plan = await f.vault.getPlan(0);
      expect(plan.active).to.equal(false);
      expect(plan.scheduled).to.equal(false);
      expect(plan.runsDone).to.equal(RUNS);
      expect(plan.fundsRemaining).to.equal(0);
      expect(await f.hss.count()).to.equal(RUNS);

      await expect(as(f.vault, f.alice).claim(0)).to.emit(f.vault, "Claimed").withArgs(0, 15_000_000_000n);
      expect(await f.hbar.balanceOf(f.alice.address)).to.equal(15_000_000_000n);
    });

    it("keeps going when the next schedule fails and works through a manual run", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);
      await f.hss.setFailScheduling(true);

      await expect(runDue(f, 0n, 0)).to.emit(f.vault, "ScheduleFailed").withArgs(0, 366);
      expect((await f.vault.getPlan(0)).scheduled).to.equal(false);

      await f.hss.setFailScheduling(false);
      const plan = await f.vault.getPlan(0);
      await time.increaseTo(plan.nextRunAt);
      await setPrices(f);
      await expect(as(f.vault, f.keeper).execute(0)).to.emit(f.vault, "RunExecuted");
      expect((await f.vault.getPlan(0)).scheduled).to.equal(true);
    });
  });

  describe("Pyth guard", () => {
    it("skips on a stale price without moving funds, then reschedules", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f, { maxPriceAge: 60 });
      const plan = await f.vault.getPlan(0);
      await time.increaseTo(plan.nextRunAt + 120n); // prices published at creation are now too old

      await expect(f.hss.fire(0)).to.emit(f.vault, "RunSkipped").withArgs(0, SkipReason.StalePrice);

      const after = await f.vault.getPlan(0);
      expect(after.runsSkipped).to.equal(1);
      expect(after.runsRemaining).to.equal(RUNS);
      expect(after.fundsRemaining).to.equal(AMOUNT * BigInt(RUNS));
      expect(await f.hss.count()).to.equal(2);
    });

    it("skips when the oracle's confidence interval is too wide", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);
      const plan = await f.vault.getPlan(0);
      await time.increaseTo(plan.nextRunAt);
      await setPrices(f, { conf: 5_000_000n }); // 5% of a $1.00 price, limit is 2%

      await expect(f.hss.fire(0)).to.emit(f.vault, "RunSkipped").withArgs(0, SkipReason.LowConfidence);
    });

    it("skips on a non-positive price", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);
      const plan = await f.vault.getPlan(0);
      await time.increaseTo(plan.nextRunAt);
      await setPrices(f, { hbarPrice: -1n });

      await expect(f.hss.fire(0)).to.emit(f.vault, "RunSkipped").withArgs(0, SkipReason.LowConfidence);
    });

    it("skips instead of buying when the pool price is worse than the oracle floor", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);
      await f.router.setRate(400, 1); // 20% below the oracle price, tolerance is 5%

      await expect(runDue(f, 0n, 0)).to.emit(f.vault, "RunSkipped").withArgs(0, SkipReason.SwapFailed);

      const plan = await f.vault.getPlan(0);
      expect(plan.fundsRemaining).to.equal(AMOUNT * BigInt(RUNS));
      expect(await f.usdc.allowance(f.vault.target, f.router.target)).to.equal(0);
    });

    it("accepts a pool price inside the slippage tolerance", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);
      await f.router.setRate(480, 1); // 4% below the oracle price, tolerance is 5%

      await expect(runDue(f, 0n, 0)).to.emit(f.vault, "RunExecuted").withArgs(0, AMOUNT, 4_800_000_000n, 5_000_000_000n, RUNS - 1);
    });

    it("pauses itself after five skips in a row, and resume restarts the schedule", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);
      await f.router.setRate(1, 1);

      for (let run = 0; run < 4; run++) await runDue(f, 0n, run);
      await expect(runDue(f, 0n, 4)).to.emit(f.vault, "PlanPaused").withArgs(0, true);

      const paused = await f.vault.getPlan(0);
      expect(paused.paused).to.equal(true);
      expect(paused.runsSkipped).to.equal(5);
      expect(await f.hss.count()).to.equal(5);

      await f.router.setRate(500, 1);
      await expect(as(f.vault, f.alice).resumePlan(0)).to.emit(f.vault, "PlanResumed").withArgs(0);
      expect(await f.hss.count()).to.equal(6);
      expect((await f.vault.getPlan(0)).skipsInARow).to.equal(0);
    });

    it("previews the guard without moving funds", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);

      const [reason, expected, minimum] = await f.vault.previewRun(0);
      expect(reason).to.equal(SkipReason.None);
      expect(expected).to.equal(5_000_000_000n);
      expect(minimum).to.equal(4_750_000_000n); // 5% slippage allowance

      await setPrices(f, { conf: 5_000_000n });
      expect((await f.vault.previewRun(0))[0]).to.equal(SkipReason.LowConfidence);
      await expect(f.vault.previewRun(99)).to.be.revertedWithCustomError(f.vault, "InvalidState");
    });
  });

  describe("owner controls", () => {
    it("pauses, ignores a stale scheduled call, and resumes", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);

      await expect(as(f.vault, f.alice).pausePlan(0)).to.emit(f.vault, "PlanPaused").withArgs(0, false);
      await expect(runDue(f, 0n, 0)).to.not.emit(f.vault, "RunExecuted");
      expect((await f.vault.getPlan(0)).runsDone).to.equal(0);

      await expect(as(f.vault, f.alice).pausePlan(0)).to.be.revertedWithCustomError(f.vault, "InvalidState");
      await as(f.vault, f.alice).resumePlan(0);
      expect((await f.vault.getPlan(0)).paused).to.equal(false);
    });

    it("cancels, refunds unsold funds and keeps bought tokens claimable", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);
      await runDue(f, 0n, 0);
      const before = await f.usdc.balanceOf(f.alice.address);

      await expect(as(f.vault, f.alice).cancelPlan(0))
        .to.emit(f.vault, "PlanCancelled")
        .withArgs(0, AMOUNT * BigInt(RUNS - 1));
      expect((await f.usdc.balanceOf(f.alice.address)) - before).to.equal(AMOUNT * BigInt(RUNS - 1));

      await expect(runDue(f, 0n, 1)).to.not.emit(f.vault, "RunExecuted");
      await expect(as(f.vault, f.alice).cancelPlan(0)).to.be.revertedWithCustomError(f.vault, "InvalidState");
      await expect(as(f.vault, f.alice).claim(0)).to.emit(f.vault, "Claimed").withArgs(0, 5_000_000_000n);
      await expect(as(f.vault, f.alice).claim(0)).to.be.revertedWithCustomError(f.vault, "NothingToClaim");
    });

    it("only lets the plan owner manage a plan", async () => {
      const f = await loadFixture(deployFixture);
      await createDefaultPlan(f);
      const vault = as(f.vault, f.bob);

      await expect(vault.pausePlan(0)).to.be.revertedWithCustomError(f.vault, "NotPlanOwner");
      await expect(vault.resumePlan(0)).to.be.revertedWithCustomError(f.vault, "NotPlanOwner");
      await expect(vault.cancelPlan(0)).to.be.revertedWithCustomError(f.vault, "NotPlanOwner");
      await expect(vault.claim(0)).to.be.revertedWithCustomError(f.vault, "NotPlanOwner");
    });
  });

  describe("refreshPrice", () => {
    function updatePayload(price: bigint, publishTime: number) {
      return ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "int64", "uint64", "int32", "uint256"],
        [ID_HBAR, price, 1n, -8, publishTime],
      );
    }

    it("forwards the oracle fee and refunds the excess", async () => {
      const f = await loadFixture(deployFixture);
      const now = await time.latest();
      const fee = 3n;

      await expect(
        as(f.vault, f.keeper).refreshPrice([updatePayload(30_000_000n, now)], { value: fee + 10n }),
      )
        .to.emit(f.vault, "PriceRefreshed")
        .withArgs(f.keeper.address, fee);

      expect((await f.pyth.getPriceNoOlderThan(ID_HBAR, 3600)).price).to.equal(30_000_000n);
      expect(await ethers.provider.getBalance(f.vault.target)).to.equal(ethers.parseEther("5"));
    });

    it("reverts when the fee is not covered", async () => {
      const f = await loadFixture(deployFixture);
      const now = await time.latest();
      await expect(as(f.vault, f.keeper).refreshPrice([updatePayload(1n, now)], { value: 1 }))
        .to.be.revertedWithCustomError(f.vault, "InsufficientUpdateFee")
        .withArgs(3, 1);
    });
  });

  describe("admin and configuration", () => {
    it("lets only the owner withdraw HBAR", async () => {
      const f = await loadFixture(deployFixture);
      await expect(as(f.vault, f.alice).withdrawHbar(f.alice.address, 1)).to.be.revertedWithCustomError(
        f.vault,
        "OwnableUnauthorizedAccount",
      );
      await expect(f.vault.withdrawHbar(f.deployer.address, ethers.parseEther("1"))).to.changeEtherBalance(
        f.vault,
        -ethers.parseEther("1"),
      );
    });

    it("rejects an invalid constructor configuration", async () => {
      const f = await loadFixture(deployFixture);
      const factory = await ethers.getContractFactory("AutoDcaVault");
      const zero = ethers.ZeroAddress;
      await expect(factory.deploy(zero, f.router.target, GAS_LIMIT, 60, f.deployer.address)).to.be.revertedWithCustomError(
        factory,
        "InvalidConfig",
      );
      await expect(factory.deploy(f.pyth.target, f.router.target, 0, 60, f.deployer.address)).to.be.revertedWithCustomError(
        factory,
        "InvalidConfig",
      );
    });
  });
});
