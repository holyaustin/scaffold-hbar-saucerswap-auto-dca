import { Contract, parseUnits, type Signer } from "ethers";

/** Inside the EVM Hedera counts HBAR in tinybar (8 decimals). JSON-RPC clients send weibar (18). */
const WEIBAR_PER_TINYBAR = 10n ** 10n;

const ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
];
const HRC719_ABI = ["function isAssociated() view returns (bool)", "function associate() returns (uint256)"];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

/** The smallest output we accept: the quote minus a slippage allowance given in percent. */
export function minOutFor(expected: bigint, slippagePct: number): bigint {
  if (!Number.isFinite(slippagePct) || slippagePct < 0 || slippagePct >= 100) {
    throw new Error("SLIPPAGE_PCT must be a number from 0 up to (but not including) 100.");
  }
  const bps = BigInt(Math.round(slippagePct * 100));
  return (expected * (10_000n - bps)) / 10_000n;
}

/** Parse a human HBAR amount such as "10" or "2.5" into tinybar. */
export function parseHbar(raw: string): bigint {
  if (!/^\d+(\.\d{1,8})?$/.test(raw.trim())) {
    throw new Error(`HBAR_TO_SWAP must be a positive number with at most 8 decimals, got "${raw}".`);
  }
  const tinybar = parseUnits(raw.trim(), 8);
  if (tinybar === 0n) throw new Error("HBAR_TO_SWAP must be greater than zero.");
  return tinybar;
}

export interface SwapOptions {
  signer: Signer;
  routerAddress: string;
  whbarAddress: string;
  tokenAddress: string;
  hbar: string;
  slippagePct: number;
  log?: (message: string) => void;
}

export interface SwapResult {
  expected: bigint;
  minOut: bigint;
  received: bigint;
  txHash: string;
  associatedNow: boolean;
}

/**
 * Buy an HTS token with HBAR through the SaucerSwap V1 router.
 *
 * Order matters on Hedera: the receiving account must already be associated with the token, or the router
 * reverts. The minimum output comes from the router's own quote, so the swap only fails if the pool moves
 * by more than the allowance between the quote and the swap.
 */
export async function swapHbarForToken(options: SwapOptions): Promise<SwapResult> {
  const { signer, routerAddress, whbarAddress, tokenAddress, hbar, slippagePct } = options;
  const log = options.log ?? (() => undefined);
  const recipient = await signer.getAddress();
  const tinybar = parseHbar(hbar);

  const hrc = new Contract(tokenAddress, HRC719_ABI, signer);
  const alreadyAssociated = await hrc.isAssociated.staticCall().catch(() => false);
  if (!alreadyAssociated) {
    log("Associating your account with the token...");
    await (await hrc.associate({ gasLimit: 800_000 })).wait();
  }

  const router = new Contract(routerAddress, ROUTER_ABI, signer);
  const path = [whbarAddress, tokenAddress];
  const amounts = (await router.getAmountsOut(tinybar, path)) as bigint[];
  const expected = amounts[amounts.length - 1];
  if (expected === 0n) throw new Error("The pool quoted zero output. It may have no liquidity for this pair.");
  const minOut = minOutFor(expected, slippagePct);
  log(`Quote: ${hbar} HBAR buys about ${expected} base units. Minimum accepted: ${minOut}.`);

  const token = new Contract(tokenAddress, ERC20_ABI, signer);
  const before = (await token.balanceOf(recipient)) as bigint;

  // Use the chain's own clock so a skewed local clock cannot make the deadline look expired.
  const latest = await signer.provider?.getBlock("latest");
  if (!latest) throw new Error("Could not read the latest block.");
  const deadline = latest.timestamp + 600;

  const tx = await router.swapExactETHForTokens(minOut, path, recipient, deadline, {
    value: tinybar * WEIBAR_PER_TINYBAR,
    gasLimit: 1_500_000,
  });
  await tx.wait();
  const after = (await token.balanceOf(recipient)) as bigint;

  return { expected, minOut, received: after - before, txHash: tx.hash, associatedNow: !alreadyAssociated };
}
