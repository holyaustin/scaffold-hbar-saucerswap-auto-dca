import { expect } from "chai";
import { accountsFromEnv } from "../lib/env";
import { resolveDeployTarget } from "../lib/target";

describe("deploy helpers", () => {
  describe("accountsFromEnv", () => {
    const key = "ab".repeat(32);

    it("returns no accounts when the key is unset or blank", () => {
      expect(accountsFromEnv(undefined)).to.deep.equal([]);
      expect(accountsFromEnv("  ")).to.deep.equal([]);
    });

    it("adds the 0x prefix when it is missing", () => {
      expect(accountsFromEnv(key)).to.deep.equal([`0x${key}`]);
      expect(accountsFromEnv(`0x${key}`)).to.deep.equal([`0x${key}`]);
    });

    it("rejects malformed keys with a helpful message", () => {
      expect(() => accountsFromEnv("not-a-key")).to.throw(/HEX encoded private key/);
      expect(() => accountsFromEnv("0x1234")).to.throw(/32-byte hex/);
    });
  });

  describe("resolveDeployTarget", () => {
    it("accepts Hedera testnet", () => {
      expect(resolveDeployTarget("hederaTestnet").chainId).to.equal(296);
    });

    it("blocks mainnet while it is coming soon", () => {
      expect(() => resolveDeployTarget("hederaMainnet")).to.throw(/coming soon/);
    });

    it("rejects networks that are not Hedera", () => {
      expect(() => resolveDeployTarget("hardhat")).to.throw(/not a Hedera deploy target/);
    });
  });
});
