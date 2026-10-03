import fs from "node:fs";
import { artifacts, network } from "hardhat";
import { Interface } from "ethers";
import { NETWORKS } from "@auto-dca/config";
import {
  cursorOf,
  encodeMessage,
  logsUrl,
  selectNewLogs,
  toAuditRecord,
  type Cursor,
  type MirrorLog,
} from "../lib/audit";
import { cursorFile, readDeployment, writeDeployment } from "../lib/deployments";
import { createClient, submitTransaction, topicCreateTransaction } from "../lib/hcs";
import { resolveDeployTarget } from "../lib/target";

/**
 * Optional audit relay: republishes the vault's run events to a Hedera Consensus Service topic.
 *
 * The contract itself cannot write to HCS, so this script reads the vault's events from the mirror node
 * and posts each one as a JSON message. The topic's submit key is the relay's key, so only this relay can
 * add messages. Each record carries the transaction hash so anyone can cross-check it on the mirror node.
 *
 * Delivery is at-least-once: if the script stops between publishing and saving its cursor, one record
 * can be published twice. Consumers should de-duplicate on (txHash, event, planId).
 */

const POLL_SECONDS = Number(process.env.RELAY_INTERVAL_SECONDS ?? "30");

function readCursor(file: string): Cursor | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Cursor) : null;
}

async function main() {
  const target = resolveDeployTarget(network.name);
  const accountId = process.env.HEDERA_ACCOUNT_ID;
  const hexKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!accountId || !hexKey) {
    throw new Error(
      "Set HEDERA_ACCOUNT_ID (for example 0.0.12345) and DEPLOYER_PRIVATE_KEY in packages/hardhat/.env. " +
        "The relay pays for HCS messages from that account.",
    );
  }

  const deployment = readDeployment(target.key);
  const { client, key } = createClient(target.key, accountId, hexKey);

  let topicId = process.env.HCS_TOPIC_ID ?? deployment.hcsTopicId;
  if (!topicId) {
    const response = await topicCreateTransaction(key).execute(client);
    const created = (await response.getReceipt(client)).topicId;
    if (!created) throw new Error("Topic creation returned no topic ID.");
    topicId = created.toString();
    writeDeployment(target.key, { ...deployment, hcsTopicId: topicId });
    console.log(`Created HCS topic ${topicId}: ${NETWORKS[target.key].explorerUrl}/topic/${topicId}`);
  } else {
    console.log(`Using HCS topic ${topicId}`);
  }

  const iface = new Interface((await artifacts.readArtifact("AutoDcaVault")).abi);
  const stateFile = cursorFile(target.key);
  const watch = process.env.RELAY_WATCH === "true";

  do {
    let cursor = readCursor(stateFile);
    const response = await fetch(logsUrl(target.mirrorUrl, deployment.vault, cursor));
    if (!response.ok) throw new Error(`Mirror node returned ${response.status}`);
    const { logs = [] } = (await response.json()) as { logs?: MirrorLog[] };

    let published = 0;
    for (const log of selectNewLogs(logs, cursor)) {
      const record = toAuditRecord(iface, log, deployment.vault, target.chainId);
      if (record) {
        const submitted = await submitTransaction(topicId, encodeMessage(record)).execute(client);
        await submitted.getReceipt(client);
        published += 1;
        console.log(`Published ${record.event} for plan ${record.planId}`);
      }
      cursor = cursorOf(log);
      fs.writeFileSync(stateFile, `${JSON.stringify(cursor)}\n`);
    }
    if (published === 0) console.log("No new events to publish.");
    if (watch) await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
  } while (watch);

  client.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
