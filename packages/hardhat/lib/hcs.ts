import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  type TopicId,
} from "@hiero-ledger/sdk";
import type { NetworkKey } from "@auto-dca/config";

/** Build a client that pays for HCS transactions with the deployer's ECDSA account. */
export function createClient(network: NetworkKey, accountId: string, hexPrivateKey: string): { client: Client; key: PrivateKey } {
  const key = PrivateKey.fromStringECDSA(hexPrivateKey.replace(/^0x/, ""));
  const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(accountId, key);
  return { client, key };
}

/**
 * A topic only its creator can write to. Without a submit key anyone could post fake "audit" messages,
 * so the relay's key is set as the submit key.
 */
export function topicCreateTransaction(key: PrivateKey): TopicCreateTransaction {
  return new TopicCreateTransaction()
    .setTopicMemo("SaucerSwap Auto-DCA audit trail")
    .setSubmitKey(key.publicKey)
    .setAdminKey(key.publicKey);
}

export function submitTransaction(topicId: string | TopicId, message: string): TopicMessageSubmitTransaction {
  return new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(message);
}
