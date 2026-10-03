import { expect } from "chai";
import { artifacts } from "hardhat";
import { vaultAbi } from "../../nextjs/lib/vaultAbi";

describe("frontend ABI", () => {
  it("matches the compiled contract (run `npm run hardhat:abi` if this fails)", async () => {
    const artifact = await artifacts.readArtifact("AutoDcaVault");
    expect(JSON.parse(JSON.stringify(vaultAbi))).to.deep.equal(artifact.abi);
  });
});
