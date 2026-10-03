import { expect } from "chai";
import { PrivateKey } from "@hiero-ledger/sdk";
import { createClient, submitTransaction, topicCreateTransaction } from "../lib/hcs";

// These tests build and freeze real SDK transactions offline. They prove the SDK calls are valid,
// but they do not send anything: publishing to a live topic must be checked on testnet.
describe("HCS transaction builders (offline)", () => {
  const hexKey = PrivateKey.generateECDSA().toStringRaw();

  it("creates a client from an ECDSA hex key, with or without a 0x prefix", () => {
    for (const key of [hexKey, `0x${hexKey}`]) {
      const { client } = createClient("testnet", "0.0.1234", key);
      expect(client.operatorAccountId?.toString()).to.equal("0.0.1234");
      client.close();
    }
  });

  it("creates a topic that only the relay can write to", () => {
    const { client, key } = createClient("testnet", "0.0.1234", hexKey);
    const transaction = topicCreateTransaction(key).freezeWith(client);
    expect(transaction.submitKey?.toString()).to.equal(key.publicKey.toString());
    expect(transaction.topicMemo).to.equal("SaucerSwap Auto-DCA audit trail");
    client.close();
  });

  it("builds a message submission for a topic", () => {
    const { client } = createClient("testnet", "0.0.1234", hexKey);
    const transaction = submitTransaction("0.0.5678", '{"v":1}').freezeWith(client);
    expect(transaction.topicId?.toString()).to.equal("0.0.5678");
    expect(Buffer.from(transaction.message ?? new Uint8Array()).toString()).to.equal('{"v":1}');
    client.close();
  });
});
