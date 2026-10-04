import { Contract, ZeroAddress, type Provider } from "ethers";
import { idToEvmAddress } from "@auto-dca/config";

/** SaucerSwap V2 pool fee tiers, in hundredths of a basis point. */
export const POOL_FEES = [500, 1500, 3000, 10000] as const;

export interface TokenInfo {
  address: string;
  symbol: string | null;
  decimals: number | null;
}

export interface PoolInfo {
  fee: number;
  pool: string;
  liquidity: bigint;
}

export interface PairReport {
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  pools: PoolInfo[];
}

/** Addresses people commonly mix up. Each one is explained when it shows up. */
const KNOWN_MISTAKES: ReadonlyArray<{ address: string; hint: string }> = [
  {
    address: idToEvmAddress("0.0.15057"),
    hint: "That is the WHBAR *contract* (0.0.15057). Pools use the WHBAR *token* 0.0.15058 (0x0000000000000000000000000000000000003ad2).",
  },
  {
    address: idToEvmAddress("0.0.429274"),
    hint: "That is Circle's testnet USDC (0.0.429274), which has no SaucerSwap pool. Use SaucerSwap's testnet USDC 0.0.5449 (0x0000000000000000000000000000000000001549).",
  },
  {
    address: ZeroAddress,
    hint: "That is the zero address. Native HBAR has no token address here: pools hold WHBAR (token 0.0.15058).",
  },
];

/** Read a token's symbol and decimals through its ERC-20 facade. Nulls mean the address did not answer like a token. */
export async function readToken(provider: Provider, address: string): Promise<TokenInfo> {
  const token = new Contract(address, ["function symbol() view returns (string)", "function decimals() view returns (uint8)"], provider);
  const [symbol, decimals] = await Promise.all([
    token.symbol().catch(() => null) as Promise<string | null>,
    token.decimals().then((value: bigint) => Number(value)).catch(() => null) as Promise<number | null>,
  ]);
  return { address, symbol, decimals };
}

/** Every fee tier at which the factory has a pool for this pair (token order does not matter). */
export async function findPools(
  provider: Provider,
  factoryAddress: string,
  tokenA: string,
  tokenB: string,
  fees: readonly number[] = POOL_FEES,
): Promise<PoolInfo[]> {
  const factory = new Contract(factoryAddress, ["function getPool(address,address,uint24) view returns (address)"], provider);
  const pools: PoolInfo[] = [];
  for (const fee of fees) {
    const pool = (await factory.getPool(tokenA, tokenB, fee)) as string;
    if (pool === ZeroAddress) continue;
    const liquidity = await new Contract(pool, ["function liquidity() view returns (uint128)"], provider)
      .liquidity()
      .then((value: bigint) => value)
      .catch(() => 0n);
    pools.push({ fee, pool, liquidity });
  }
  return pools;
}

/** Plain-English findings and next steps for a pair report. */
export function adviceFor(report: PairReport, requestedFee: number): string[] {
  const advice: string[] = [];

  for (const token of [report.tokenA, report.tokenB]) {
    if (token.symbol === null || token.decimals === null) {
      advice.push(`${token.address} did not answer like a token. Check the address, and that it is a testnet token ID converted to an EVM address.`);
    }
    const mistake = KNOWN_MISTAKES.find((known) => known.address.toLowerCase() === token.address.toLowerCase());
    if (mistake) advice.push(mistake.hint);
  }

  const atRequested = report.pools.find((pool) => pool.fee === requestedFee);
  if (report.pools.length === 0) {
    advice.push("No V2 pool exists for this pair at any fee tier. Either the pair has no V2 pool, or one of the addresses is wrong. Pick a different pair.");
  } else if (!atRequested) {
    const fees = report.pools.map((pool) => pool.fee).join(", ");
    advice.push(`No pool at fee ${requestedFee}, but this pair has pools at: ${fees}. Set POOL_FEE to one of those.`);
  } else if (atRequested.liquidity === 0n) {
    advice.push(`The pool at fee ${requestedFee} exists but reports no liquidity, so a swap would fail. Try another fee tier or pair.`);
  } else {
    advice.push(`Ready: a pool with liquidity exists at fee ${requestedFee}.`);
  }
  return advice;
}

/** True when the pair can be used at the requested fee tier. */
export function isUsable(report: PairReport, requestedFee: number): boolean {
  const pool = report.pools.find((candidate) => candidate.fee === requestedFee);
  return Boolean(pool && pool.liquidity > 0n && report.tokenA.symbol !== null && report.tokenB.symbol !== null);
}
