import fs from "node:fs";
import path from "node:path";
import type { NetworkKey } from "@auto-dca/config";

const hardhatDir = path.resolve(__dirname, "../deployments");
const frontendFile = path.resolve(__dirname, "../../nextjs/lib/deployments.json");

export interface DeploymentRecord {
  vault: string;
  deployer?: string;
  chainId?: number;
  hcsTopicId?: string;
  [key: string]: unknown;
}

export function readDeployment(key: NetworkKey): DeploymentRecord {
  const file = path.join(hardhatDir, `${key}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No deployment found for ${key}. Run \`npm run hardhat:deploy\` first.`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as DeploymentRecord;
}

/** Save the full record next to the contracts, and the public subset where the web app reads it. */
export function writeDeployment(key: NetworkKey, record: DeploymentRecord): void {
  fs.mkdirSync(hardhatDir, { recursive: true });
  fs.writeFileSync(path.join(hardhatDir, `${key}.json`), `${JSON.stringify(record, null, 2)}\n`);

  const all = JSON.parse(fs.readFileSync(frontendFile, "utf8")) as Record<string, unknown>;
  all[key] = {
    vault: record.vault,
    deployedAt: record.deployedAt,
    ...(record.hcsTopicId ? { hcsTopicId: record.hcsTopicId } : {}),
  };
  fs.writeFileSync(frontendFile, `${JSON.stringify(all, null, 2)}\n`);
}

export function cursorFile(key: NetworkKey): string {
  return path.join(hardhatDir, `hcs-relay-state.${key}.json`);
}
