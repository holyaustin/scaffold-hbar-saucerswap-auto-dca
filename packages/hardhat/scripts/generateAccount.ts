import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { NETWORKS } from "@auto-dca/config";

/** Create a throwaway ECDSA deployer key and save it to packages/hardhat/.env if none exists. */
async function main() {
  const envPath = path.resolve(__dirname, "../.env");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  if (/^DEPLOYER_PRIVATE_KEY=0?x?[0-9a-fA-F]{64}\s*$/m.test(existing)) {
    console.log("packages/hardhat/.env already has a DEPLOYER_PRIVATE_KEY. Nothing changed.");
    return;
  }

  const wallet = ethers.Wallet.createRandom();
  const line = `DEPLOYER_PRIVATE_KEY=${wallet.privateKey}`;
  const next = /^DEPLOYER_PRIVATE_KEY=.*$/m.test(existing)
    ? existing.replace(/^DEPLOYER_PRIVATE_KEY=.*$/m, line)
    : `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${line}\n`;
  fs.writeFileSync(envPath, next, { mode: 0o600 });

  console.log("New deployer account saved to packages/hardhat/.env (never commit this file).");
  console.log(`EVM address: ${wallet.address}`);
  console.log(`Send it testnet HBAR from ${NETWORKS.testnet.faucetUrl} before deploying.`);
  console.log("The account is created on Hedera when it first receives HBAR.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
