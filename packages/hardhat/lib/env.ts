/** Turn DEPLOYER_PRIVATE_KEY into a Hardhat accounts array, failing early on malformed keys. */
export function accountsFromEnv(rawKey: string | undefined): string[] {
  const trimmed = rawKey?.trim();
  if (!trimmed) return [];
  const key = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      "DEPLOYER_PRIVATE_KEY must be a 32-byte hex string (64 hex characters). " +
        "Use the HEX encoded private key of an ECDSA account, not a DER-encoded key.",
    );
  }
  return [key];
}
