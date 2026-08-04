import "server-only";

import type { ProviderConnection } from "@/domain/provider/provider";
import {
  StalwartJmapHttpError,
  StalwartJmapMethodError,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { clearGateway } from "@/server/mail/gateway-cache";
import { getMailService } from "@/server/mail/mail-service";
import {
  installSnoozeOperationPort,
  SnoozeProviderError,
  type SnoozeOperationPort,
} from "@/server/snooze/snooze-operation.port";

const authenticationFailure = (error: unknown): boolean =>
  error instanceof StalwartJmapHttpError &&
    (error.status === 401 || error.status === 403) ||
  typeof error === "object" && error !== null &&
    "authenticationFailed" in error && error.authenticationFailed === true;

const terminalFailure = (error: unknown): boolean =>
  error instanceof StalwartJmapMethodError &&
    error.kind === "definitive" && error.type !== "stateMismatch" ||
  error instanceof Error && error.constructor === Error && !("code" in error);

const withService = async <T>(
  connection: ProviderConnection,
  task: (service: Awaited<ReturnType<typeof getMailService>>) => Promise<T>,
): Promise<T> => {
  try {
    return await task(await getMailService(connection));
  } catch (error) {
    if (error instanceof SnoozeProviderError) throw error;
    if (authenticationFailure(error)) {
      throw new SnoozeProviderError("authentication");
    }
    if (terminalFailure(error)) {
      throw new SnoozeProviderError("terminal");
    }
    throw new SnoozeProviderError("transient");
  } finally {
    clearGateway(connection.id);
  }
};

export const providerSnoozeOperationAdapter: SnoozeOperationPort = {
  getAccountScope: (connection) => withService(
    connection, (service) => service.getSnoozeAccountScope(),
  ),
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
