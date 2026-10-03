"use strict";

/**
 * Network registry shared by the Hardhat package and the Next.js app.
 *
 * Both networks are fully described here. Mainnet is marked "coming-soon":
 * every consumer checks `isLive()` before it lets a user sign anything.
 * To open mainnet later, change one field (`status`) after your own audit.
 *
 * Sources (checked 1 Oct 2026):
 *  - SaucerSwap IDs:   https://docs.saucerswap.finance/developers/contracts
 *  - Pyth contract:    https://docs.pyth.network/price-feeds/core/contract-addresses/evm
 *  - System contracts: https://docs.hedera.com/hedera/core-concepts/smart-contracts/system-smart-contracts
 */

const HEDERA_ID_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Convert a Hedera entity ID (0.0.N) to its long-zero EVM address.
 * Layout: 4 bytes shard, 8 bytes realm, 8 bytes number.
 * @param {string} id
 * @returns {string} lowercase 0x-prefixed 20-byte address
 */
function idToEvmAddress(id) {
  const match = HEDERA_ID_PATTERN.exec(id);
  if (!match) throw new Error(`Invalid Hedera ID: ${id}`);
  const [shard, realm, num] = match.slice(1).map((part) => BigInt(part));
  if (shard >= 2n ** 32n || realm >= 2n ** 64n || num >= 2n ** 64n) {
    throw new Error(`Hedera ID out of range: ${id}`);
  }
  const hex = (value, bytes) => value.toString(16).padStart(bytes * 2, "0");
  return `0x${hex(shard, 4)}${hex(realm, 8)}${hex(num, 8)}`;
}

/** Hedera system contracts, fixed on every network. */
const SYSTEM_CONTRACTS = Object.freeze({
  hts: "0x0000000000000000000000000000000000000167",
  hss: "0x000000000000000000000000000000000000016b",
});

/** Pyth is deployed at the same EVM address on Hedera mainnet and testnet. */
const PYTH_EVM_ADDRESS = "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729";

/** SaucerSwap V2 pool fee tiers (hundredths of a basis point). */
const POOL_FEE_TIERS = Object.freeze([
  { fee: 500, label: "0.05%" },
  { fee: 1500, label: "0.15%" },
  { fee: 3000, label: "0.30%" },
  { fee: 10000, label: "1.00%" },
]);

const NETWORKS = Object.freeze({
  testnet: Object.freeze({
    key: "testnet",
    label: "Hedera testnet",
    status: "live",
    chainId: 296,
    hardhatName: "hederaTestnet",
    rpcUrl: "https://testnet.hashio.io/api",
    mirrorUrl: "https://testnet.mirrornode.hedera.com",
    explorerUrl: "https://hashscan.io/testnet",
    faucetUrl: "https://portal.hedera.com/faucet",
    pyth: PYTH_EVM_ADDRESS,
    saucerSwap: Object.freeze({
      swapRouterId: "0.0.1414040",
      quoterId: "0.0.1390002",
      factoryId: "0.0.1197038",
      whbarTokenId: "0.0.15058",
    }),
  }),
  mainnet: Object.freeze({
    key: "mainnet",
    label: "Hedera mainnet",
    status: "coming-soon",
    chainId: 295,
    hardhatName: "hederaMainnet",
    rpcUrl: "https://mainnet.hashio.io/api",
    mirrorUrl: "https://mainnet-public.mirrornode.hedera.com",
    explorerUrl: "https://hashscan.io/mainnet",
    faucetUrl: null,
    pyth: PYTH_EVM_ADDRESS,
    saucerSwap: Object.freeze({
      swapRouterId: "0.0.3949434",
      quoterId: "0.0.3949424",
      factoryId: "0.0.3946833",
      whbarTokenId: "0.0.1456986",
    }),
  }),
});

/**
 * @param {string | undefined | null} key
 * @returns {"testnet" | "mainnet"}
 */
function resolveNetworkKey(key) {
  if (key === undefined || key === null || key === "") return "testnet";
  if (key === "testnet" || key === "mainnet") return key;
  throw new Error(`Unknown network "${key}". Use "testnet" or "mainnet".`);
}

/** @param {{ status: string }} network */
function isLive(network) {
  return network.status === "live";
}

/**
 * EVM addresses for the SaucerSwap contracts of a network.
 * @param {"testnet" | "mainnet"} key
 */
function saucerSwapAddresses(key) {
  const { saucerSwap } = NETWORKS[key];
  return {
    swapRouter: idToEvmAddress(saucerSwap.swapRouterId),
    quoter: idToEvmAddress(saucerSwap.quoterId),
    factory: idToEvmAddress(saucerSwap.factoryId),
    whbarToken: idToEvmAddress(saucerSwap.whbarTokenId),
  };
}

module.exports = {
  NETWORKS,
  SYSTEM_CONTRACTS,
  PYTH_EVM_ADDRESS,
  POOL_FEE_TIERS,
  idToEvmAddress,
  isLive,
  resolveNetworkKey,
  saucerSwapAddresses,
};
