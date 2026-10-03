import { ethers, network } from "hardhat";
import { resolveDeployTarget } from "../lib/target";

/**
 * Associate your account with an HTS token (HIP-719) so you can receive it.
 * You need this for the token you are buying before you can `claim`.
 * Usage: TOKEN=0x... npm run hardhat:associate
 */
async function main() {
  resolveDeployTarget(network.name);
  const token = process.env.TOKEN;
  if (!token || !ethers.isAddress(token)) throw new Error("Set TOKEN to the EVM address of the HTS token.");

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("No deployer account configured.");
  const hrc719 = new ethers.Contract(
    token,
    ["function associate() returns (uint256)", "function isAssociated() view returns (bool)"],
    signer,
  );

  const already = await hrc719.isAssociated.staticCall().catch(() => false);
  if (already) {
    console.log("Already associated.");
    return;
  }
  const tx = await hrc719.associate({ gasLimit: 800_000 });
  await tx.wait();
  console.log(`Associated ${signer.address} with ${token}. Tx: ${tx.hash}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
