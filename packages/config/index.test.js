"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NETWORKS,
  LOCAL_DEMO,
  SYSTEM_CONTRACTS,
  idToEvmAddress,
  isLive,
  resolveNetworkKey,
  saucerSwapAddresses,
} = require("./index.js");

test("idToEvmAddress encodes shard.realm.num as a long-zero address", () => {
  assert.equal(idToEvmAddress("0.0.1"), "0x0000000000000000000000000000000000000001");
  assert.equal(idToEvmAddress("0.0.363"), SYSTEM_CONTRACTS.hss);
  assert.equal(idToEvmAddress("0.0.359"), SYSTEM_CONTRACTS.hts);
  assert.equal(idToEvmAddress("0.0.1414040"), "0x0000000000000000000000000000000000159398");
});

test("idToEvmAddress rejects malformed and out-of-range ids", () => {
  assert.throws(() => idToEvmAddress("1414040"), /Invalid Hedera ID/);
  assert.throws(() => idToEvmAddress("0.0.x"), /Invalid Hedera ID/);
  assert.throws(() => idToEvmAddress("0.0.18446744073709551616"), /out of range/);
});

test("testnet is live and mainnet is coming soon", () => {
  assert.equal(isLive(NETWORKS.testnet), true);
  assert.equal(isLive(NETWORKS.mainnet), false);
  assert.equal(NETWORKS.testnet.chainId, 296);
  assert.equal(NETWORKS.mainnet.chainId, 295);
});

test("both networks resolve complete SaucerSwap address sets", () => {
  for (const key of ["testnet", "mainnet"]) {
    const addresses = saucerSwapAddresses(key);
    for (const value of Object.values(addresses)) {
      assert.match(value, /^0x[0-9a-f]{40}$/);
    }
  }
  assert.notEqual(saucerSwapAddresses("testnet").swapRouter, saucerSwapAddresses("mainnet").swapRouter);
  assert.equal(saucerSwapAddresses("testnet").v1Router, "0x0000000000000000000000000000000000004b40");
  assert.equal(saucerSwapAddresses("testnet").usdcToken, "0x0000000000000000000000000000000000001549");
});

test("resolveNetworkKey defaults to testnet and rejects unknown names", () => {
  assert.equal(resolveNetworkKey(undefined), "testnet");
  assert.equal(resolveNetworkKey(""), "testnet");
  assert.equal(resolveNetworkKey("mainnet"), "mainnet");
  assert.throws(() => resolveNetworkKey("previewnet"), /Unknown network/);
});

test("registry objects are frozen", () => {
  assert.throws(() => {
    "use strict";
    NETWORKS.testnet.status = "coming-soon";
  }, TypeError);
});

test("the local demo network is separate from the real networks", () => {
  assert.equal(LOCAL_DEMO.chainId, 31337);
  assert.equal(LOCAL_DEMO.explorerUrl, null);
  assert.equal(Object.keys(NETWORKS).includes("local"), false);
  assert.throws(() => resolveNetworkKey("local"), /Unknown network/);
  assert.throws(() => {
    "use strict";
    LOCAL_DEMO.rpcUrl = "http://evil";
  }, TypeError);
});
