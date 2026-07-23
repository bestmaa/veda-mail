import "server-only";

import { MailApplicationService } from "@/application/services/mail-application.service";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { resolveGateway } from "@/server/mail/gateway-cache";

export const getMailService = async (): Promise<MailApplicationService> => {
  const connection = await getCurrentConnection();
  const gateway = await resolveGateway(connection);
  return new MailApplicationService(gateway);
};
