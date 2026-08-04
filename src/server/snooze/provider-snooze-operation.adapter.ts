import "server-only";

import type { ProviderConnection } from "@/domain/provider/provider";
import { clearGateway } from "@/server/mail/gateway-cache";
import { getMailService } from "@/server/mail/mail-service";
import {
  installSnoozeOperationPort,
  SnoozeProviderError,
  type SnoozeOperationPort,
} from "@/server/snooze/snooze-operation.port";

const withService = async <T>(
  connection: ProviderConnection,
  task: (service: Awaited<ReturnType<typeof getMailService>>) => Promise<T>,
): Promise<T> => {
  try {
    return await task(await getMailService(connection));
  } catch (error) {
    if (error instanceof SnoozeProviderError) throw error;
    throw new SnoozeProviderError("transient");
  } finally {
    clearGateway(connection.id);
  }
};

export const providerSnoozeOperationAdapter: SnoozeOperationPort = {
  getCapability: (connection) => withService(
    connection, (service) => service.getSnoozeCapability(),
  ),
  hide: (connection, plan) => withService(
    connection, (service) => service.hideSnooze(plan),
  ),
  inspect: (connection, plan) => withService(
    connection, (service) => service.inspectSnooze(plan),
  ),
  mailboxIntent: (connection) => withService(
    connection, (service) => service.snoozeMailboxIntent(),
  ),
  preflight: (connection, input) => withService(
    connection, (service) => service.preflightSnooze(input),
  ),
  restore: (connection, plan) => withService(
    connection, (service) => service.restoreSnooze(plan),
  ),
};

export const installProviderSnoozeOperationAdapter = (): void => {
  installSnoozeOperationPort(providerSnoozeOperationAdapter);
};
