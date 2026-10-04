import { ethers, network } from "hardhat";
import { saucerSwapAddresses } from "@auto-dca/config";
import { POOL_FEES, adviceFor, findPools, isUsable, readToken } from "../lib/pairCheck";
import { resolveDeployTarget } from "../lib/target";

/**
 * Read-only check of a token pair against SaucerSwap V2. It needs no private key and spends nothing.
 * With no TOKEN_IN / TOKEN_OUT set it checks SaucerSwap's testnet USDC against WHBAR as a known example.
 *
 *   TOKEN_IN=0x... TOKEN_OUT=0x... POOL_FEE=3000 npm run hardhat:check-pair
 */
async function main() {
  const target = resolveDeployTarget(network.name);
  const addresses = saucerSwapAddresses(target.key);
  const tokenIn = process.env.TOKEN_IN ?? addresses.usdcToken;
  const tokenOut = process.env.TOKEN_OUT ?? addresses.whbarToken;
  const fee = Number(process.env.POOL_FEE ?? "3000");
  if (!ethers.isAddress(tokenIn) || !ethers.isAddress(tokenOut)) {
    throw new Error("TOKEN_IN and TOKEN_OUT must be 0x EVM addresses (42 characters).");
  }

  console.log(`Checking ${tokenIn} -> ${tokenOut} on ${target.label}, fee tier ${fee}\n`);
  const report = {
    tokenA: await readToken(ethers.provider, tokenIn),
    tokenB: await readToken(ethers.provider, tokenOut),
    pools: await findPools(ethers.provider, addresses.factory, tokenIn, tokenOut),
  };

  for (const token of [report.tokenA, report.tokenB]) {
    console.log(`Token ${token.address}: ${token.symbol ?? "(no answer)"}${token.decimals === null ? "" : `, ${token.decimals} decimals`}`);
  }
  console.log("");
  for (const tier of POOL_FEES) {
    const pool = report.pools.find((candidate) => candidate.fee === tier);
    console.log(
      `Fee ${String(tier).padStart(5)}: ${pool ? `pool ${pool.pool}, liquidity ${pool.liquidity}` : "no pool"}${tier === fee ? "   <- requested" : ""}`,
    );
  }
  console.log("");
  for (const line of adviceFor(report, fee)) console.log(`- ${line}`);
  process.exitCode = isUsable(report, fee) ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
