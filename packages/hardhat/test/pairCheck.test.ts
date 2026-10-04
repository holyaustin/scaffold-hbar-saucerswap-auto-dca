import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { Contract } from "ethers";
import { idToEvmAddress } from "@auto-dca/config";
import { adviceFor, findPools, isUsable, readToken, type PairReport } from "../lib/pairCheck";

async function setup() {
  const deploy = async (name: string, ...args: unknown[]) =>
    (await (await ethers.getContractFactory(name)).deploy(...args)) as unknown as Contract;
  const usdc = await deploy("MockToken", "USD Coin", "USDC", 6);
  const whbar = await deploy("MockToken", "Wrapped HBAR", "WHBAR", 8);
  const factory = await deploy("MockPoolFactory");
  const deepPool = await deploy("MockPool", 1_000_000n);
  const emptyPool = await deploy("MockPool", 0n);
  return { usdc, whbar, factory, deepPool, emptyPool };
}

const token = (address: string, symbol: string | null = "TKN") => ({ address, symbol, decimals: symbol ? 6 : null });

describe("pair check", () => {
  it("reads a token's symbol and decimals, and reports nulls for an address that is not a token", async () => {
    const { usdc } = await loadFixture(setup);
    expect(await readToken(ethers.provider, await usdc.getAddress())).to.deep.include({ symbol: "USDC", decimals: 6 });
    const notAToken = await readToken(ethers.provider, "0x00000000000000000000000000000000000000aa");
    expect(notAToken).to.deep.include({ symbol: null, decimals: null });
  });

  it("finds pools at each fee tier regardless of token order, with their liquidity", async () => {
    const { usdc, whbar, factory, deepPool, emptyPool } = await loadFixture(setup);
    const a = await usdc.getAddress();
    const b = await whbar.getAddress();
    await factory.setPool(a, b, 3000, await deepPool.getAddress());
    await factory.setPool(b, a, 500, await emptyPool.getAddress());

    for (const [x, y] of [[a, b], [b, a]]) {
      const pools = await findPools(ethers.provider, await factory.getAddress(), x, y);
      expect(pools.map((pool) => [pool.fee, pool.liquidity])).to.deep.equal([[500, 0n], [3000, 1_000_000n]]);
    }
    expect(await findPools(ethers.provider, await factory.getAddress(), a, "0x00000000000000000000000000000000000000bb")).to.deep.equal([]);
  });

  describe("advice", () => {
    const pool = (fee: number, liquidity: bigint) => ({ fee, pool: "0xpool", liquidity });
    const report = (pools: PairReport["pools"], a = token("0x1"), b = token("0x2")): PairReport => ({ tokenA: a, tokenB: b, pools });

    it("says it is ready when a liquid pool exists at the requested fee", () => {
      const r = report([pool(3000, 5n)]);
      expect(adviceFor(r, 3000)).to.deep.equal(["Ready: a pool with liquidity exists at fee 3000."]);
      expect(isUsable(r, 3000)).to.equal(true);
    });

    it("points to the right fee tier when the requested one has no pool", () => {
      const r = report([pool(500, 5n), pool(10000, 5n)]);
      expect(adviceFor(r, 3000)[0]).to.contain("pools at: 500, 10000").and.to.contain("Set POOL_FEE");
      expect(isUsable(r, 3000)).to.equal(false);
    });

    it("says there is no pool at all, and warns about empty pools", () => {
      expect(adviceFor(report([]), 3000)[0]).to.contain("No V2 pool exists for this pair at any fee tier");
      expect(adviceFor(report([pool(3000, 0n)]), 3000)[0]).to.contain("no liquidity");
      expect(isUsable(report([pool(3000, 0n)]), 3000)).to.equal(false);
    });

    it("explains addresses that do not answer like tokens", () => {
      const r = report([], token("0x00000000000000000000000000000000000000aa", null));
      expect(adviceFor(r, 3000).join(" ")).to.contain("did not answer like a token");
    });

    it("recognises the classic mix-ups: WHBAR contract, Circle's USDC, and the zero address", () => {
      const whbarContract = adviceFor(report([], token(idToEvmAddress("0.0.15057"), "WHBAR")), 3000).join(" ");
      expect(whbarContract).to.contain("WHBAR *contract*").and.to.contain("0.0.15058");
      expect(adviceFor(report([], token(idToEvmAddress("0.0.429274"), "USDC")), 3000).join(" ")).to.contain("Circle's testnet USDC");
      expect(adviceFor(report([], token(ethers.ZeroAddress, null)), 3000).join(" ")).to.contain("zero address");
    });
  });
});
