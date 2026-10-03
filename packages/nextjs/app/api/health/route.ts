import { NextResponse } from "next/server";
import { activeNetwork, auditTopicId, vaultAddress } from "~/lib/networks";

export const dynamic = "force-dynamic";

/** Cheap liveness probe: reports the configured network and whether a vault is wired up. */
export function GET() {
  const network = activeNetwork();
  return NextResponse.json({
    ok: true,
    network: network.key,
    networkStatus: network.status,
    vaultConfigured: vaultAddress(network.key) !== null,
    auditTopicConfigured: auditTopicId(network.key) !== null,
  });
}
