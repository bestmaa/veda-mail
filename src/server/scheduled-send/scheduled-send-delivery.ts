import "server-only";

import {
  DraftConflictError,
  DraftContentTruncatedError,
  DraftInputError,
  DraftNotFoundError,
  DraftUnavailableError,
} from "@/domain/mail/draft-errors";
import {
  MessageDeliveryRejectedError,
  OutgoingMessageSizeError,
} from "@/domain/mail/mail-errors";
import type { SendMessageInput, SendReceipt } from "@/domain/mail/mail";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { clearGateway } from "@/server/mail/gateway-cache";
import { getMailService } from "@/server/mail/mail-service";
import type { ScheduledJob } from "@/server/scheduled-send/scheduled-send-record";

export type ScheduledDeliveryPort = (
  connection: ProviderConnection,
  input: SendMessageInput,
) => Promise<SendReceipt>;

const defaultDelivery: ScheduledDeliveryPort = async (connection, input) =>
  (await getMailService(connection)).sendMessage(input);

export const scheduledJobConnection = (
  job: ScheduledJob,
): ProviderConnection => ({
  config: job.connection.config,
  createdAt: job.connection.createdAt,
  displayName: job.connection.displayName,
  id: id.connection(job.connection.id),
  providerId: id.provider(job.connection.providerId),
});

export const scheduledJobSendInput = (job: ScheduledJob): SendMessageInput => ({
  bcc: job.request.bcc,
  body: job.request.body,
  cc: job.request.cc,
  ...(job.request.htmlBody ? { htmlBody: job.request.htmlBody } : {}),
  ...(job.request.inReplyTo ? { inReplyTo: job.request.inReplyTo } : {}),
  providerDraft: {
    composeId: job.request.draftId,
    expectedRevision: job.request.expectedDraftRevision,
    id: job.request.providerDraftId,
  },
  subject: job.request.subject,
  to: job.request.to,
});

export const isTerminalScheduledSendError = (error: unknown): boolean =>
  error instanceof DraftConflictError ||
  error instanceof DraftContentTruncatedError ||
  error instanceof DraftInputError ||
  error instanceof DraftNotFoundError ||
  error instanceof DraftUnavailableError ||
  error instanceof MessageDeliveryRejectedError ||
  error instanceof OutgoingMessageSizeError;

export const scheduledSendErrorMessage = (error: unknown): string =>
  error instanceof DraftConflictError
    ? "The saved draft changed before its scheduled send."
    : error instanceof DraftNotFoundError
      ? "The saved draft no longer exists."
      : error instanceof MessageDeliveryRejectedError
        ? "The provider rejected every recipient."
        : error instanceof OutgoingMessageSizeError
          ? "The message exceeds the provider size limit."
          : isTerminalScheduledSendError(error)
            ? "The saved draft can no longer be sent safely."
            : "The provider is temporarily unavailable.";

export const deliverScheduledJob = async (
  job: ScheduledJob,
  deliver: ScheduledDeliveryPort = defaultDelivery,
): Promise<SendReceipt> => {
  const connection = scheduledJobConnection(job);
  try {
    return await deliver(connection, scheduledJobSendInput(job));
  } finally {
    clearGateway(connection.id);
  }
};
