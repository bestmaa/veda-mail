import "server-only";

import { MailApplicationService } from "@/application/services/mail-application.service";
import type { ProviderConnection } from "@/domain/provider/provider";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { resolveGateway } from "@/server/mail/gateway-cache";

export const getMailService = async (
  currentConnection?: ProviderConnection,
): Promise<MailApplicationService> => {
  const connection = currentConnection ?? (await getCurrentConnection());
  const gateway = await resolveGateway(connection);
  return new MailApplicationService(gateway);
};
