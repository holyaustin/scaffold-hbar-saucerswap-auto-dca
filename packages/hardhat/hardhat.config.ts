import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import * as dotenv from "dotenv";
import type { HardhatUserConfig } from "hardhat/config";
import { NETWORKS } from "@auto-dca/config";
import { accountsFromEnv } from "./lib/env";

dotenv.config();

const accounts = accountsFromEnv(process.env.DEPLOYER_PRIVATE_KEY);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      // "paris" avoids opcodes newer than the EVM version Hedera is documented to run.
      evmVersion: "paris",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    // Both Hedera networks are configured. Mainnet is blocked at deploy time (see lib/target.ts).
    hederaTestnet: {
      url: process.env.HEDERA_TESTNET_RPC_URL || NETWORKS.testnet.rpcUrl,
      chainId: NETWORKS.testnet.chainId,
      accounts,
      timeout: 120_000,
    },
    hederaMainnet: {
      url: process.env.HEDERA_MAINNET_RPC_URL || NETWORKS.mainnet.rpcUrl,
      chainId: NETWORKS.mainnet.chainId,
      accounts,
      timeout: 120_000,
    },
  },
  mocha: { timeout: 120_000 },
};

export default config;
