export const erc20Abi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

/** HIP-719: an HTS token lets an account associate itself by calling `associate()` on the token address. */
export const hrc719Abi = [
  { type: "function", name: "associate", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isAssociated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;

export const pythAbi = [
  {
    type: "function",
    name: "getUpdateFee",
    stateMutability: "view",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
