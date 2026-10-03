import { ethers, network } from "hardhat";
import { saucerSwapAddresses } from "@auto-dca/config";
import { writeDeployment } from "../lib/deployments";
import { resolveDeployTarget } from "../lib/target";

async function main() {
  const target = resolveDeployTarget(network.name);
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account. Run `npm run hardhat:account` or set DEPLOYER_PRIVATE_KEY in packages/hardhat/.env.");
  }

  const gasLimit = BigInt(process.env.SCHEDULED_CALL_GAS_LIMIT ?? "2000000");
  const minInterval = Number(process.env.MIN_INTERVAL_SECONDS ?? "60");
  const fundHbar = process.env.FUND_HBAR ?? "5";
  const { swapRouter } = saucerSwapAddresses(target.key);

  console.log(`Deploying AutoDcaVault to ${target.label} as ${deployer.address}`);
  const factory = await ethers.getContractFactory("AutoDcaVault");
  const vault = await factory.deploy(target.pyth, swapRouter, gasLimit, minInterval, deployer.address);
  const deployTx = vault.deploymentTransaction();
  await vault.waitForDeployment();
  const address = await vault.getAddress();
  console.log(`Vault deployed at ${address}`);

  // The vault pays gas for its own scheduled runs, so it needs HBAR. Sending value to `receive()` runs code.
  const fundTx = await deployer.sendTransaction({
    to: address,
    value: ethers.parseEther(fundHbar),
    gasLimit: 100_000,
  });
  await fundTx.wait();
  console.log(`Funded the vault with ${fundHbar} HBAR for scheduled runs`);

  const record = {
    vault: address,
    deployer: deployer.address,
    chainId: target.chainId,
    pyth: target.pyth,
    swapRouter,
    deployTxHash: deployTx?.hash ?? null,
    deployedAt: new Date().toISOString(),
  };

  writeDeployment(target.key, record);

  console.log(`\nContract:     ${target.explorerUrl}/contract/${address}`);
  if (record.deployTxHash) console.log(`Deploy tx:    ${target.explorerUrl}/transaction/${record.deployTxHash}`);
  console.log("Next: npm run hardhat:demo-plan");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
