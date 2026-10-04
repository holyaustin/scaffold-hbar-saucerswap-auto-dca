import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { Contract } from "ethers";
import { minOutFor, parseHbar, swapHbarForToken } from "../lib/getTokens";

async function setup() {
  const [user] = await ethers.getSigners();
  const deploy = async (name: string, ...args: unknown[]) =>
    (await (await ethers.getContractFactory(name)).deploy(...args)) as unknown as Contract;
  const usdc = await deploy("MockHrc719Token", "USD Coin", "USDC", 6);
  const whbar = await deploy("MockToken", "Wrapped HBAR", "WHBAR", 8);
  const router = await deploy("MockSaucerSwapV1Router");
  return { user, usdc, whbar, router };
}

describe("getting testnet USDC with HBAR", () => {
  it("applies a slippage allowance and rejects nonsense", () => {
    expect(minOutFor(1_000_000n, 10)).to.equal(900_000n);
    expect(minOutFor(1_000_000n, 0)).to.equal(1_000_000n);
    expect(minOutFor(1_000_000n, 0.5)).to.equal(995_000n);
    for (const bad of [-1, 100, Number.NaN]) expect(() => minOutFor(1n, bad)).to.throw(/SLIPPAGE_PCT/);
  });

  it("parses HBAR into tinybar", () => {
    expect(parseHbar("10")).to.equal(1_000_000_000n);
    expect(parseHbar("2.5")).to.equal(250_000_000n);
    for (const bad of ["0", "-1", "abc", "1.123456789", ""]) expect(() => parseHbar(bad)).to.throw(/HBAR_TO_SWAP/);
  });

  it("associates first, then swaps, and credits the account", async () => {
    const { user, usdc, whbar, router } = await loadFixture(setup);
    const messages: string[] = [];

    const result = await swapHbarForToken({
      signer: user,
      routerAddress: await router.getAddress(),
      whbarAddress: await whbar.getAddress(),
      tokenAddress: await usdc.getAddress(),
      hbar: "10",
      slippagePct: 10,
      log: (m) => messages.push(m),
    });

    // 10 HBAR = 1e9 tinybar, at 100 token units per tinybar.
    expect(result.expected).to.equal(100_000_000_000n);
    expect(result.received).to.equal(100_000_000_000n);
    expect(result.associatedNow).to.equal(true);
    expect(messages[0]).to.contain("Associating");
    expect(await usdc.balanceOf(user.address)).to.equal(100_000_000_000n);
  });

  it("skips the association step when it already exists, as after a half-finished app swap", async () => {
    const { user, usdc, whbar, router } = await loadFixture(setup);
    await usdc.associate();

    const result = await swapHbarForToken({
      signer: user,
      routerAddress: await router.getAddress(),
      whbarAddress: await whbar.getAddress(),
      tokenAddress: await usdc.getAddress(),
      hbar: "1",
      slippagePct: 5,
    });
    expect(result.associatedNow).to.equal(false);
    expect(result.received).to.equal(10_000_000_000n);
  });

  it("fails on slippage when the pool moves more than the allowance, and works with more room", async () => {
    const { user, usdc, whbar, router } = await loadFixture(setup);
    await router.setDrift(true); // pays 10% less than it quoted
    const base = {
      signer: user,
      routerAddress: await router.getAddress(),
      whbarAddress: await whbar.getAddress(),
      tokenAddress: await usdc.getAddress(),
      hbar: "1",
    };

    await expect(swapHbarForToken({ ...base, slippagePct: 5 })).to.be.rejectedWith(/INSUFFICIENT_OUTPUT_AMOUNT/);
    const result = await swapHbarForToken({ ...base, slippagePct: 15 });
    expect(result.received).to.equal(9_000_000_000n);
  });

  it("explains a pool with no liquidity instead of sending the swap", async () => {
    const { user, usdc, whbar, router } = await loadFixture(setup);
    await router.setRate(0);
    await expect(
      swapHbarForToken({
        signer: user,
        routerAddress: await router.getAddress(),
        whbarAddress: await whbar.getAddress(),
        tokenAddress: await usdc.getAddress(),
        hbar: "1",
        slippagePct: 10,
      }),
    ).to.be.rejectedWith(/no liquidity/);
  });
});
