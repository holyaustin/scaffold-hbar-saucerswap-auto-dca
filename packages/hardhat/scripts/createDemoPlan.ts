import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";
import type { Log, LogDescription } from "ethers";
import { saucerSwapAddresses } from "@auto-dca/config";
import { adviceFor, findPools, isUsable, readToken } from "../lib/pairCheck";
import { resolveDeployTarget } from "../lib/target";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in packages/hardhat/.env (see .env.example).`);
  return value;
}

async function main() {
  const target = resolveDeployTarget(network.name);
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("No deployer account configured.");

  const deployments = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../deployments/${target.key}.json`), "utf8"));
  const tokenIn = required("TOKEN_IN");
  const tokenOut = required("TOKEN_OUT");
  const fee = Number(process.env.POOL_FEE ?? "3000");
  const runs = Number(process.env.RUNS ?? "3");

  // 1. Make sure SaucerSwap actually has a usable pool, so the demo cannot fail silently.
  const { factory } = saucerSwapAddresses(target.key);
  const report = {
    tokenA: await readToken(ethers.provider, tokenIn),
    tokenB: await readToken(ethers.provider, tokenOut),
    pools: await findPools(ethers.provider, factory, tokenIn, tokenOut),
  };
  if (!isUsable(report, fee)) {
    throw new Error(`This pair cannot be used at fee ${fee}:\n- ${adviceFor(report, fee).join("\n- ")}\n\nFor a full report run: TOKEN_IN=${tokenIn} TOKEN_OUT=${tokenOut} npm run hardhat:check-pair`);
  }
  console.log(`Found SaucerSwap pool ${report.pools.find((pool) => pool.fee === fee)?.pool}`);

  // 2. Approve the whole budget, then create the plan.
  const token = new ethers.Contract(
    tokenIn,
    ["function decimals() view returns (uint8)", "function approve(address,uint256) returns (bool)"],
    signer,
  );
  const decimals: bigint = await token.decimals();
  const amountPerRun = ethers.parseUnits(process.env.AMOUNT_PER_RUN ?? "1", decimals);
  const total = amountPerRun * BigInt(runs);
  await (await token.approve(deployments.vault, total, { gasLimit: 800_000 })).wait();

  const vault = await ethers.getContractAt("AutoDcaVault", deployments.vault, signer);
  const params = {
    tokenIn,
    tokenOut,
    path: ethers.solidityPacked(["address", "uint24", "address"], [tokenIn, fee, tokenOut]),
    amountPerRun,
    runs,
    intervalSeconds: Number(process.env.INTERVAL_SECONDS ?? "120"),
    maxSlippageBps: Number(process.env.MAX_SLIPPAGE_BPS ?? "500"),
    maxConfBps: Number(process.env.MAX_CONF_BPS ?? "200"),
    maxPriceAge: Number(process.env.MAX_PRICE_AGE ?? "3600"),
    priceIdIn: required("PRICE_ID_IN"),
    priceIdOut: required("PRICE_ID_OUT"),
  };

  const tx = await vault.createPlan(params, { gasLimit: 2_500_000 });
  const receipt = await tx.wait();
  const created = receipt?.logs
    .map((log: Log) => vault.interface.parseLog(log))
    .find((parsed: LogDescription | null) => parsed?.name === "PlanCreated");
  console.log(`Plan ${created?.args.planId ?? "?"} created. Tx: ${target.explorerUrl}/transaction/${tx.hash}`);
  console.log("HSS will now run it on schedule. Watch the contract's events on HashScan.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
