import "server-only";

import { randomUUID } from "node:crypto";

import type {
  SnoozeBulkItem,
  SnoozeBulkOutcome,
  SnoozeOwner,
} from "@/domain/mail/snooze";
import type { ProviderConnection } from "@/domain/provider/provider";
import { getMailService } from "@/server/mail/mail-service";
import {
  getSnoozeOperationPort,
  type SnoozeOperationPort,
} from "@/server/snooze/snooze-operation.port";
import { snoozeConfigured } from "@/server/snooze/snooze-key";
import { snoozeStore } from "@/server/snooze/snooze-store";
import { ApiError } from "@/transport/http/api-error";

export const snoozeOwner = async (
  connection: ProviderConnection,
): Promise<SnoozeOwner> => {
  const account = await (await getMailService(connection)).getAccount();
  return { email: account.email, providerId: account.providerId };
};
export const readSnoozeWorkspace = async (
  connection: ProviderConnection,
  port: SnoozeOperationPort = getSnoozeOperationPort(),
) => {
  if (!snoozeConfigured()) return {
    book: { messages: [], revision: null, snoozedMailboxId: null, version: 1 as const },
    capability: { maxMessages: 0 as const,
      reason: "Durable snooze storage is not configured.",
      snoozedMailboxId: null, supported: false as const },
  };
  const owner = await snoozeOwner(connection);
  const [book, capability] = await Promise.all([
    snoozeStore.list(owner), port.getCapability(connection),
  ]);
  return { book, capability: capability.supported ? {
    ...capability,
    snoozedMailboxId: book.snoozedMailboxId ?? capability.snoozedMailboxId,
  } : capability };
};
const rejection = (messageId: SnoozeBulkItem["messageId"], error: unknown): SnoozeBulkOutcome => ({
  errorCode: error instanceof ApiError ? error.code : "SNOOZE_PROVIDER_FAILED",
  messageId, snoozeId: null, status: "rejected",
});
const assertConfigured = (): void => {
  if (!snoozeConfigured()) throw new ApiError(
    "Durable snooze storage is not configured.", "SNOOZE_UNAVAILABLE", 422,
  );
};

export const createSnoozes = async (
  connection: ProviderConnection,
  items: readonly SnoozeBulkItem[],
  port: SnoozeOperationPort = getSnoozeOperationPort(),
) => {
  assertConfigured();
  const owner = await snoozeOwner(connection);
  const capability = await port.getCapability(connection);
  if (!capability.supported) {
    throw new ApiError(capability.reason, "SNOOZE_PROVIDER_UNSUPPORTED", 422);
  }
  const intent = await port.mailboxIntent(connection);
  const mailbox = await snoozeStore.ensureMailboxIntent(owner, intent);
  const outcomes: SnoozeBulkOutcome[] = [];
  for (const item of items) {
    const operationId = randomUUID();
    try {
      const preflight = await port.preflight(connection, {
        messageId: item.messageId, operationId, ownedMailbox: mailbox,
        sourceMailboxId: item.sourceMailboxId,
      });
      const admitted = await snoozeStore.admit({
        connection, item, operationId, owner, preflight,
      });
      outcomes.push({ errorCode: null, messageId: item.messageId,
        snoozeId: admitted.jobId, status: "accepted" });
    } catch (error) { outcomes.push(rejection(item.messageId, error)); }
  }
  return { book: await snoozeStore.list(owner), outcomes };
};

export const rescheduleSnooze = async (
  connection: ProviderConnection, jobId: string, wakeAt: string,
) => {
  assertConfigured();
  return snoozeStore.reschedule(await snoozeOwner(connection), jobId, wakeAt, connection);
};
export const restoreSnooze = async (
  connection: ProviderConnection, jobId: string,
) => {
  assertConfigured();
  return snoozeStore.requestRestore(await snoozeOwner(connection), jobId, connection);
};
export const retrySnooze = async (
  connection: ProviderConnection, jobId: string,
) => {
  assertConfigured();
  return snoozeStore.retry(await snoozeOwner(connection), jobId, connection);
};

export const snoozeBulkHttpStatus = (
  outcomes: readonly SnoozeBulkOutcome[],
): 201 | 207 => outcomes.every(({ status }) => status === "accepted") ? 201 : 207;
