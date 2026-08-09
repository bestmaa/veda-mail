import "server-only";
import type { SavedSearchOwner } from "@/domain/mail/saved-search";
import type { ProviderConnection } from "@/domain/provider/provider";
import { resolveGateway } from "@/server/mail/gateway-cache";
export const savedSearchOwnerForConnection = async (connection: ProviderConnection): Promise<SavedSearchOwner> => ({
  email: (await (await resolveGateway(connection)).getAccount()).email,
  providerId: connection.providerId,
});
