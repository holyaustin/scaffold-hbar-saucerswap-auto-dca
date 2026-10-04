import { ethers, network } from "hardhat";
import { saucerSwapAddresses } from "@auto-dca/config";
import { swapHbarForToken } from "../lib/getTokens";
import { resolveDeployTarget } from "../lib/target";

/**
 * Buy testnet USDC with testnet HBAR straight from the command line, through the SaucerSwap V1 router.
 * Use it when the SaucerSwap web app will not complete the swap.
 *
 *   HBAR_TO_SWAP=10 SLIPPAGE_PCT=10 npm run hardhat:get-usdc
 */
async function main() {
  const target = resolveDeployTarget(network.name);
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("No account configured. Set DEPLOYER_PRIVATE_KEY in packages/hardhat/.env.");

  const addresses = saucerSwapAddresses(target.key);
  const hbar = process.env.HBAR_TO_SWAP ?? "10";
  const slippagePct = Number(process.env.SLIPPAGE_PCT ?? "10");

  console.log(`Account ${signer.address} on ${target.label}`);
  const balance = await ethers.provider.getBalance(signer.address);
  console.log(`HBAR balance: ${ethers.formatEther(balance)}`);

  const result = await swapHbarForToken({
    signer,
    routerAddress: addresses.v1Router,
    whbarAddress: addresses.whbarToken,
    tokenAddress: addresses.usdcToken,
    hbar,
    slippagePct,
    log: console.log,
  });

  console.log(`\nDone. You received ${ethers.formatUnits(result.received, 6)} USDC.`);
  console.log(`Transaction: ${target.explorerUrl}/transaction/${result.txHash}`);
  console.log(`Your tokens:  ${target.explorerUrl}/account/${signer.address}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  if (/INSUFFICIENT_OUTPUT_AMOUNT|slippage/i.test(message)) {
    console.error("\nThe pool moved more than your allowance. Retry with a higher SLIPPAGE_PCT or a smaller HBAR_TO_SWAP.");
  }
  process.exitCode = 1;
});
