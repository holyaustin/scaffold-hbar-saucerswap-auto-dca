import { expect } from "chai";
import { artifacts } from "hardhat";
import { Interface } from "ethers";
import {
  MAX_MESSAGE_BYTES,
  cursorOf,
  encodeMessage,
  logsUrl,
  selectNewLogs,
  toAuditRecord,
  type AuditRecord,
  type MirrorLog,
} from "../lib/audit";

const VAULT = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 296;

async function vaultInterface() {
  return new Interface((await artifacts.readArtifact("AutoDcaVault")).abi);
}

function logFor(iface: Interface, eventName: string, args: unknown[], timestamp: string, index: number): MirrorLog {
  const encoded = iface.encodeEventLog(iface.getEvent(eventName)!, args);
  return { topics: [...encoded.topics], data: encoded.data, transaction_hash: "0xabc", timestamp, index };
}

describe("HCS audit relay logic", () => {
  describe("toAuditRecord", () => {
    it("turns a RunExecuted log into a flat record with string values", async () => {
      const iface = await vaultInterface();
      const log = logFor(iface, "RunExecuted", [1n, 10_000_000n, 5_000_000_000n, 5_000_000_000n, 2], "1790000000.123456789", 0);

      expect(toAuditRecord(iface, log, VAULT, CHAIN_ID)).to.deep.equal({
        v: 1,
        vault: VAULT,
        chainId: CHAIN_ID,
        event: "RunExecuted",
        planId: "1",
        args: { amountIn: "10000000", amountOut: "5000000000", oracleExpectedOut: "5000000000", runsRemaining: "2" },
        txHash: "0xabc",
        consensusTimestamp: "1790000000.123456789",
      });
    });

    it("keeps skip reasons so the trail explains why a purchase did not happen", async () => {
      const iface = await vaultInterface();
      const record = toAuditRecord(iface, logFor(iface, "RunSkipped", [7n, 1], "1.0", 0), VAULT, CHAIN_ID);
      expect(record).to.include({ event: "RunSkipped", planId: "7" });
      expect(record?.args).to.deep.equal({ reason: "1" });
    });

    it("ignores bookkeeping events and logs that are not the vault's", async () => {
      const iface = await vaultInterface();
      const scheduled = logFor(iface, "RunScheduled", [1n, 1790000100n, VAULT], "1.0", 0);
      expect(toAuditRecord(iface, scheduled, VAULT, CHAIN_ID)).to.equal(null);

      const foreign: MirrorLog = { topics: [`0x${"11".repeat(32)}`], data: "0x", transaction_hash: "0x1", timestamp: "1.0", index: 0 };
      expect(toAuditRecord(iface, foreign, VAULT, CHAIN_ID)).to.equal(null);
    });
  });

  describe("selectNewLogs", () => {
    const base = { topics: [], data: "0x", transaction_hash: "0x1" };
    const a: MirrorLog = { ...base, timestamp: "100.000000001", index: 0 };
    const b: MirrorLog = { ...base, timestamp: "100.000000001", index: 1 };
    const c: MirrorLog = { ...base, timestamp: "100.500000000", index: 0 };

    it("returns everything, oldest first, when there is no cursor", () => {
      expect(selectNewLogs([c, b, a], null)).to.deep.equal([a, b, c]);
    });

    it("resumes inside a transaction without dropping or repeating logs", () => {
      expect(selectNewLogs([a, b, c], cursorOf(a))).to.deep.equal([b, c]);
      expect(selectNewLogs([a, b, c], cursorOf(b))).to.deep.equal([c]);
      expect(selectNewLogs([a, b, c], cursorOf(c))).to.deep.equal([]);
    });

    it("compares nanosecond fractions numerically, not as text", () => {
      const early: MirrorLog = { ...base, timestamp: "100.123456789", index: 0 };
      const late: MirrorLog = { ...base, timestamp: "100.5", index: 0 };
      expect(selectNewLogs([late, early], null)).to.deep.equal([early, late]);
      expect(selectNewLogs([early, late], cursorOf(early))).to.deep.equal([late]);
    });
  });

  describe("encodeMessage and logsUrl", () => {
    const record: AuditRecord = {
      v: 1,
      vault: VAULT,
      chainId: CHAIN_ID,
      event: "RunSkipped",
      planId: "1",
      args: { reason: "1" },
      txHash: `0x${"ab".repeat(32)}`,
      consensusTimestamp: "1790000000.123456789",
    };

    it("produces compact JSON well under the HCS message limit", () => {
      const message = encodeMessage(record);
      expect(JSON.parse(message)).to.deep.equal(record);
      expect(Buffer.byteLength(message)).to.be.lessThan(MAX_MESSAGE_BYTES);
    });

    it("refuses a message that cannot fit in one HCS message", () => {
      expect(() => encodeMessage({ ...record, args: { blob: "x".repeat(2000) } })).to.throw(/larger than/);
    });

    it("asks the mirror node for logs at or after the cursor", () => {
      expect(logsUrl("https://m.example", VAULT, null)).to.equal(
        `https://m.example/api/v1/contracts/${VAULT}/results/logs?order=asc&limit=100`,
      );
      expect(logsUrl("https://m.example", VAULT, { timestamp: "5.1", index: 2 }, 10)).to.equal(
        `https://m.example/api/v1/contracts/${VAULT}/results/logs?order=asc&limit=10&timestamp=gte:5.1`,
      );
    });
  });
});
