import { Dashboard } from "~/components/Dashboard";
import { activeNetworkKey, auditTopicId, vaultAddress } from "~/lib/networks";

export const dynamic = "force-dynamic";

export default function Home() {
  const networkKey = activeNetworkKey();
  return <Dashboard networkKey={networkKey} vault={vaultAddress(networkKey)} auditTopic={auditTopicId(networkKey)} />;
}
