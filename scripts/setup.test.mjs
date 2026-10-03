import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readEnvValue, upsertEnvLine, validatePythKey } from "./lib/env-file.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setup = path.join(repo, "scripts/setup.mjs");

/** A throwaway copy of just the files setup.mjs touches. */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-"));
  fs.mkdirSync(path.join(dir, "packages/config"), { recursive: true });
  fs.copyFileSync(path.join(repo, "packages/config/index.js"), path.join(dir, "packages/config/index.js"));
  for (const pkg of ["hardhat", "nextjs"]) {
    fs.mkdirSync(path.join(dir, "packages", pkg), { recursive: true });
    fs.copyFileSync(path.join(repo, "packages", pkg, ".env.example"), path.join(dir, "packages", pkg, ".env.example"));
  }
  return dir;
}
const run = (dir, ...args) =>
  spawnSync(process.execPath, [setup, "--root", dir, "--yes", ...args], { encoding: "utf8" });
const envLocal = (dir) => path.join(dir, "packages/nextjs/.env.local");

test("upsertEnvLine replaces a commented example, an existing value, or appends", () => {
  assert.equal(upsertEnvLine("# PYTH_API_KEY=\nA=1\n", "PYTH_API_KEY", "k"), "PYTH_API_KEY=k\nA=1\n");
  assert.equal(upsertEnvLine("PYTH_API_KEY=old\n", "PYTH_API_KEY", "new"), "PYTH_API_KEY=new\n");
  assert.equal(upsertEnvLine("A=1", "B", "2"), "A=1\nB=2\n");
  assert.equal(upsertEnvLine("# K=\n", "K", "a$&b"), "K=a$&b\n");
});

test("readEnvValue reads only uncommented values", () => {
  assert.equal(readEnvValue("# K=1\nK=2\n", "K"), "2");
  assert.equal(readEnvValue("# K=1\n", "K"), undefined);
});

test("validatePythKey accepts keys, treats blank as skip, and rejects obvious mistakes", () => {
  assert.deepEqual(validatePythKey("  "), { ok: true, value: null });
  assert.deepEqual(validatePythKey(undefined), { ok: true, value: null });
  assert.deepEqual(validatePythKey(" abcd1234efgh "), { ok: true, value: "abcd1234efgh" });
  assert.equal(validatePythKey("two words here").ok, false);
  assert.equal(validatePythKey("short").ok, false);
  assert.equal(validatePythKey("https://hermes.pyth.network").ok, false);
  assert.equal(validatePythKey("0x" + "ab".repeat(32)).ok, false);
});

test("setup creates env files for testnet and saves a supplied Pyth key", () => {
  const dir = sandbox();
  const result = run(dir, "--pyth-key", "my-pyth-key-12345");
  assert.equal(result.status, 0, result.stderr);
  const content = fs.readFileSync(envLocal(dir), "utf8");
  assert.match(content, /^NEXT_PUBLIC_HEDERA_NETWORK=testnet$/m);
  assert.match(content, /^PYTH_API_KEY=my-pyth-key-12345$/m);
  assert.equal(fs.statSync(envLocal(dir)).mode & 0o777, 0o600);
  assert.ok(fs.existsSync(path.join(dir, "packages/hardhat/.env")));
  assert.doesNotMatch(result.stdout, /my-pyth-key-12345/, "the key must never be printed");
});

test("without a key, setup skips it and says how to add it later", () => {
  const dir = sandbox();
  const result = run(dir);
  assert.equal(result.status, 0);
  assert.doesNotMatch(fs.readFileSync(envLocal(dir), "utf8"), /^PYTH_API_KEY=.+$/m);
  assert.match(result.stdout, /No Pyth key saved/);
});

test("re-running keeps files, and adding a key later updates only that line", () => {
  const dir = sandbox();
  run(dir);
  fs.appendFileSync(envLocal(dir), "CUSTOM=keep-me\n");

  assert.match(run(dir).stdout, /kept\s+packages\/nextjs\/\.env\.local/);
  const updated = run(dir, "--pyth-key", "second-key-98765");
  assert.match(updated.stdout, /updated\s+packages\/nextjs\/\.env\.local \(PYTH_API_KEY\)/);
  const content = fs.readFileSync(envLocal(dir), "utf8");
  assert.match(content, /^PYTH_API_KEY=second-key-98765$/m);
  assert.match(content, /^CUSTOM=keep-me$/m);
});

test("mainnet is rejected as coming soon and writes nothing", () => {
  const dir = sandbox();
  const result = run(dir, "--network", "mainnet");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /coming soon/);
  assert.equal(fs.existsSync(envLocal(dir)), false);
});

test("a malformed Pyth key is rejected before anything is written", () => {
  const dir = sandbox();
  const result = run(dir, "--pyth-key", "has spaces in it");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no spaces/);
  assert.equal(fs.existsSync(envLocal(dir)), false);
});
