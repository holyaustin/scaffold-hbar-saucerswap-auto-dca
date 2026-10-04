#!/usr/bin/env node
// One-command offline demo: a local node, mock Hedera services, the web app, and a scheduler that plays
// the part of the Hedera Schedule Service. Needs no testnet account, no HBAR and no API keys.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPortOpen, prefixLines, waitFor } from "./lib/process.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFile = path.join(root, "packages/nextjs/public/demo-config.json");
const NODE_PORT = 8545;
const WEB_PORT = Number(process.env.PORT ?? 3000);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const children = [];
let stopping = false;

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping the demo...");
  for (const child of children) child.kill("SIGINT");
  setTimeout(() => process.exit(code), 1500).unref();
}

function start(name, args, { env = {}, showStdout = true } = {}) {
  const child = spawn(npm, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const label = `[${name}]`;
  if (showStdout) child.stdout.on("data", (chunk) => console.log(prefixLines(label, String(chunk))));
  child.stderr.on("data", (chunk) => console.error(prefixLines(label, String(chunk))));
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`${label} stopped unexpectedly (exit code ${code}).`);
      stopAll(1);
    }
  });
  children.push(child);
  return child;
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

if (await isPortOpen(NODE_PORT)) {
  console.error(`Port ${NODE_PORT} is already in use, probably by another local node. Stop it and try again.`);
  process.exit(1);
}
if (await isPortOpen(WEB_PORT)) {
  console.error(`Port ${WEB_PORT} is already in use. Stop that app, or run with PORT=3001 npm run demo:local.`);
  process.exit(1);
}

// A leftover file from an earlier run would point the web app at contracts that no longer exist.
fs.rmSync(configFile, { force: true });

console.log("Starting a local node (no real network, no HBAR needed)...");
start("node", ["run", "node", "-w", "@auto-dca/hardhat"], { showStdout: false });

if (!(await waitFor(() => isPortOpen(NODE_PORT), { timeoutMs: 120_000 }))) {
  console.error("The local node did not start in time. Run `npm run hardhat:compile` once and retry.");
  stopAll(1);
} else {
  start("scheduler", ["run", "demo-local", "-w", "@auto-dca/hardhat"]);

  if (!(await waitFor(() => fs.existsSync(configFile), { timeoutMs: 120_000 }))) {
    console.error("The demo contracts were not deployed in time. See the [scheduler] output above.");
    stopAll(1);
  } else {
    start("web", ["run", "dev", "-w", "@auto-dca/nextjs"], {
      env: { NEXT_PUBLIC_HEDERA_NETWORK: "local", PORT: String(WEB_PORT) },
    });
    console.log(`\nWeb app: http://localhost:${WEB_PORT}  (first load compiles, give it a few seconds)\n`);
  }
}
