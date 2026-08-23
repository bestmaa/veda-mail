import "server-only";

import type { ProviderConnection } from "@/domain/provider/provider";
import { resolveGateway } from "@/server/mail/gateway-cache";
import { mailForwardingStore } from "@/server/mail-forwarding/mail-forwarding.store";

export const readMemberMailForwarding = async (
  connection: ProviderConnection,
) => {
  const account = await (await resolveGateway(connection)).getAccount();
  const match = await mailForwardingStore.getForSource(account.email);
  return match ? {
    destinationEmail: match.destinationEmail,
    enabled: true as const,
    keepLocalCopy: true as const,
    status: match.status,
  } : { enabled: false as const };
};
