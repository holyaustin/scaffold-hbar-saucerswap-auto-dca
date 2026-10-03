# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## What this is

A scaffold-hbar template: recurring SaucerSwap V2 buys on Hedera, scheduled by HSS and guarded by Pyth prices. npm workspaces: `packages/config`, `packages/hardhat`, `packages/nextjs`.

## Commands (run from the repo root)

| Task | Command |
|------|---------|
| Install | `npm install` |
| Lint everything | `npm run lint` |
| Test everything | `npm test` |
| Contract tests only | `npm run hardhat:test` |
| Compile contracts | `npm run hardhat:compile` |
| Regenerate the web app's ABI | `npm run hardhat:abi` |
| Build | `npm run build` |
| Deploy to testnet | `npm run hardhat:deploy` |
| Web app | `npm run next:dev` |
| Publish run events to HCS (optional) | `npm run hardhat:audit-relay` |

Always run `npm run lint && npm test` before finishing a change. After any change to `AutoDcaVault.sol`'s public interface, regenerate the ABI. `packages/hardhat/test/abi.test.ts` fails if you forget.

## Architecture rules

- **Single source of truth for networks and addresses:** `packages/config/index.js`. Never copy an address, chain ID or URL into another file.
- **Mainnet is "coming soon".** Do not remove the `isLive` checks, the `resolveDeployTarget` guard or the disabled network button. Opening mainnet means changing one `status` field on purpose, after review.
- **Hedera system contracts** live at `0x167` (HTS) and `0x16b` (HSS). Call them with low-level `call`/`staticcall` and read the response code. `scheduleCall` does **not** revert on failure.
- **Units:** inside the EVM, HBAR amounts (`msg.value`, oracle fees) are tinybar (8 decimals). JSON-RPC clients send weibar (18 decimals). Convert at the client edge only.
- **Pyth is a pull oracle.** Never assume a fresh price is on-chain. Handle stale prices as a skip, not a revert.
- **The Pyth API key is server-side only.** Never read `PYTH_API_KEY` in a client component and never prefix it with `NEXT_PUBLIC_`.
- **Contracts never write to HCS.** The relay does, off-chain. Do not describe the HCS trail as written by the contract. Keep the topic's submit key set to the relay key, and keep the cursor as `(timestamp, index)`.
- **EVM version is `paris`** and Solidity is `0.8.24`. Do not use opcodes or features that need a newer EVM.

## Testing rules

- Contract tests install mocks at the real system addresses with `hardhat_setCode` (see `test/fixture.ts`). Extend the mocks rather than weakening assertions.
- Every new revert path needs a test. Every new event needs an `emit` assertion.
- Relay logic lives in `packages/hardhat/lib/audit.ts` as pure functions. Network calls stay in `scripts/auditRelay.ts`.
- Web app logic that is not rendering belongs in `packages/nextjs/lib` as a pure function with a vitest test.

## Do not

- Do not commit `.env`, `.env.local`, private keys or API keys. Only `.env.example` files are tracked.
- Do not add an LLM or any paid service as a required dependency.
- Do not hand-edit `packages/nextjs/lib/vaultAbi.ts`. It is generated.
- Do not edit `packages/nextjs/lib/deployments.json` by hand. The deploy script writes it.
- Do not add dead code, commented-out code or unused exports.
- Do not claim something works on testnet unless you ran it there. List it under "verify on testnet" in the README instead.

## Extending

- **A new guard** (for example a maximum price ceiling): add a `SkipReason`, return it from `_evaluate`, add a label in `packages/nextjs/lib/format.ts`, add tests for both the skip and the pass case, regenerate the ABI.
- **A different DEX route:** plans already store a SaucerSwap path (`token | fee | token ...`). Multi-hop paths work if both endpoints match `tokenIn` and `tokenOut`.
- **A new network:** add it to `packages/config/index.js` with `status: "coming-soon"` first, then follow the "open mainnet" steps in the README.
