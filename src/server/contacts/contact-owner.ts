import "server-only";

import type { ContactOwner } from "@/domain/member/contact";
import type { ProviderConnection } from "@/domain/provider/provider";
import { resolveGateway } from "@/server/mail/gateway-cache";

export const contactOwnerForConnection = async (
  connection: ProviderConnection,
): Promise<ContactOwner> => ({
  email: (await (await resolveGateway(connection)).getAccount()).email,
  providerId: connection.providerId,
});
