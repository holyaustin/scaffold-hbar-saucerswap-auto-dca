#!/usr/bin/env node
// First-run helper: choose a network, optionally add your Pyth API key, and create the local .env files.
// It never asks for a private key, so no wallet secret ends up in your shell history.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readEnvValue, upsertEnvLine, validatePythKey } from "./lib/env-file.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : (args[index + 1] ?? "");
};

const root = flag("root") ? path.resolve(flag("root")) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { NETWORKS, isLive } = require(path.join(root, "packages/config/index.js"));
const interactive = !args.includes("--yes") && Boolean(process.stdin.isTTY);

const PYTH_HELP = `
Pyth API key (optional)
  The app uses Pyth prices as a safety guard. To push a fresh price on-chain from the web app,
  Pyth's Hermes service needs an API key (free trial):
  https://docs.pyth.network/price-feeds/core/upgrade/preparing
  The key is stored only in packages/nextjs/.env.local and is never sent to the browser.
  Without it everything else works. Press Enter to skip and add it later.
`;

function describe(network, number) {
  return `  ${number}) Hedera ${network.key}${isLive(network) ? "" : "   (coming soon, not selectable yet)"}`;
}

function pickNetwork(key) {
  const network = NETWORKS[key];
  if (!network) throw new Error(`Unknown network "${key}". Choose testnet or mainnet.`);
  if (!isLive(network)) throw new Error(`Hedera ${key} is coming soon. Choose testnet for now.`);
  return network;
}

async function chooseNetwork() {
  const requested = flag("network");
  if (requested !== undefined) return pickNetwork(requested);
  if (!interactive) return pickNetwork("testnet");

  const options = Object.values(NETWORKS);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\nWhich network do you want to use?\n");
    options.forEach((network, index) => console.log(describe(network, index + 1)));
    for (;;) {
      const answer = (await rl.question("\nEnter 1 or 2 [1]: ")).trim() || "1";
      const choice = options[Number(answer) - 1];
      if (!choice) console.log("Please enter 1 or 2.");
      else if (!isLive(choice)) console.log(`Hedera ${choice.key} is coming soon. Please pick testnet for now.`);
      else return choice;
    }
  } finally {
    rl.close();
  }
}

/** Read a line without echoing it, so the key is not left on screen or in terminal scrollback. */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = "";
    const finish = (callback) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      callback();
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") return finish(() => resolve(value));
        if (character === "\u0003") return finish(() => reject(new Error("Cancelled.")));
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    };
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function choosePythKey() {
  const provided = flag("pyth-key");
  if (provided !== undefined) {
    const result = validatePythKey(provided);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }
  if (!interactive) return null;

  console.log(PYTH_HELP);
  for (;;) {
    const result = validatePythKey(await askHidden("Paste your Pyth API key (hidden), or press Enter to skip: "));
    if (!result.ok) {
      console.log(result.error);
      continue;
    }
    if (result.value) console.log(`Key received (${result.value.length} characters).`);
    return result.value;
  }
}

/** Create the file from its example, or update only the given keys if it already exists. */
function writeEnv(dir, exampleName, targetName, values) {
  const target = path.join(root, dir, targetName);
  const label = path.join(dir, targetName);
  const exists = fs.existsSync(target);
  let content = fs.readFileSync(exists ? target : path.join(root, dir, exampleName), "utf8");

  // Only touch what actually changes, so re-running never disturbs a file you have edited.
  const entries = Object.entries(values).filter(
    ([key, value]) => value !== null && value !== undefined && (!exists || readEnvValue(content, key) !== value),
  );
  if (exists && entries.length === 0) {
    console.log(`  kept     ${label} (already exists)`);
    return;
  }
  for (const [key, value] of entries) content = upsertEnvLine(content, key, value);
  fs.writeFileSync(target, content, { mode: 0o600 });
  console.log(`  ${exists ? "updated" : "created"}  ${label}${exists ? ` (${entries.map(([key]) => key).join(", ")})` : ""}`);
}

try {
  const network = await chooseNetwork();
  const pythKey = await choosePythKey();

  console.log(`\nSetting up for ${network.label}\n`);
  writeEnv("packages/hardhat", ".env.example", ".env", {});
  writeEnv("packages/nextjs", ".env.example", ".env.local", {
    NEXT_PUBLIC_HEDERA_NETWORK: network.key,
    PYTH_API_KEY: pythKey,
  });
  console.log(`
Next steps
  1. npm run hardhat:account     create a deployer key (or paste your Portal ECDSA key into packages/hardhat/.env)
  2. Fund that address with testnet HBAR at ${network.faucetUrl}
  3. npm run hardhat:deploy      deploy the vault
  4. npm run next:dev            open http://localhost:3000
${pythKey ? "" : "\nNo Pyth key saved. To enable the Refresh price button later, add PYTH_API_KEY to packages/nextjs/.env.local.\n"}`);
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
