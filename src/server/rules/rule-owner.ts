import "server-only";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import type { ProviderConnection } from "@/domain/provider/provider";
import type { MailRuleOwner } from "@/server/rules/rule-record";

export const ruleOwnerForConnection = async (
  connection: ProviderConnection,
  gateway: MailGateway,
): Promise<MailRuleOwner> => ({
  email: (await gateway.getAccount()).email,
  providerId: connection.providerId,
});
