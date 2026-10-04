import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { deployDemo, keeperTick, toDemoConfig, type KeeperState } from "../lib/demo";

/**
 * Deploys the offline demo to a local Hardhat node, writes the config the web app reads, and then plays
 * the part of the Hedera Schedule Service until you stop it. Start it with `npm run demo:local`.
 */
async function main() {
  if (hre.network.name !== "localhost") {
    throw new Error("The local demo only runs against a local node. Use `npm run demo:local` from the repo root.");
  }

  console.log("Deploying demo contracts to the local node...");
  const ctx = await deployDemo(hre);
  const config = await toDemoConfig(hre, ctx);

  const target = path.resolve(__dirname, "../../nextjs/public/demo-config.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);

  console.log(`
Demo is ready.
  Vault          ${config.vault}
  Demo tokens    mUSDC (you hold 1000)  ->  mWHBAR
  Oracle         USDC $1.00, HBAR $0.20 (refreshed automatically)
  Scheduler      this process fires each scheduled run when it is due, like HSS does on Hedera

Open the web app, create a plan, and watch it run. Use the "Demo controls" panel to make the price
stale or the pool price bad and see the guard skip a purchase. Press Ctrl+C to stop.
`);

  const state: KeeperState = { fired: new Set(), ticks: 0 };
  let running = true;
  process.once("SIGINT", () => {
    running = false;
  });
  process.once("SIGTERM", () => {
    running = false;
  });

  while (running) {
    try {
      for (const event of await keeperTick(hre, ctx, state)) {
        const label = event.kind === "fired" ? "scheduled run" : "scheduled run FAILED";
        console.log(`[${new Date().toLocaleTimeString()}] ${label} #${event.scheduleIndex}: ${event.message}`);
      }
    } catch (error) {
      console.error("Keeper tick failed:", error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
