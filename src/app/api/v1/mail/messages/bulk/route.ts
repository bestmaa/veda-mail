import type {
  BulkMessageMutation,
  BulkMessageMutationResult,
  MessageMutation,
} from "@/domain/mail/mail";
import type { MessageId } from "@/domain/shared/brand";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { getMailService } from "@/server/mail/mail-service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { ApiError } from "@/transport/http/api-error";
import { readJsonBody } from "@/transport/http/read-json-body";
import { bulkMessageMutationSchema } from "@/transport/http/request-schemas";

export const runtime = "nodejs";

const mutationFor = (
  request: BulkMessageMutation,
  messageId: MessageId,
): MessageMutation => {
  if (request.type === "set-read" || request.type === "set-starred") {
    return { messageId, type: request.type, value: request.value };
  }
  if (request.type === "destroy" || request.type === "move") {
    return { mailboxId: request.mailboxId, messageId, type: request.type };
  }
  return { messageId, type: request.type };
};

const runBounded = async (
  request: BulkMessageMutation,
  mutate: (mutation: MessageMutation) => Promise<void>,
): Promise<BulkMessageMutationResult> => {
  const succeeded: MessageId[] = [];
  const failed: MessageId[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < request.messageIds.length) {
      const messageId = request.messageIds[cursor++];
      if (!messageId) continue;
      try {
        await mutate(mutationFor(request, messageId));
        succeeded.push(messageId);
      } catch {
        failed.push(messageId);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, request.messageIds.length) }, worker),
  );
  return { failed, succeeded };
};

export const PATCH = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(
      request,
      "mail-bulk-mutation",
      5_000,
      200,
      60 * 1_000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit(
      "mail-bulk-mutation",
      connection.id,
      20,
      60 * 1_000,
    );
    const payload = bulkMessageMutationSchema.parse(
      await readJsonBody(request, 64 * 1_024),
    );
    const service = await getMailService(connection);
    if (payload.type === "destroy") {
      const source = (await service.listMailboxes()).find(
        (mailbox) => mailbox.id === payload.mailboxId,
      );
      if (source?.role !== "spam" && source?.role !== "trash") {
        throw new ApiError(
          "Permanent deletion is allowed only from Spam or Trash.",
          "PERMANENT_DELETE_FORBIDDEN",
          400,
        );
      }
    }
    const result = await runBounded(payload, async (mutation) => {
      if (mutation.type === "destroy") {
        const message = await service.getMessage(mutation.messageId);
        if (!message.mailboxIds.includes(mutation.mailboxId)) {
          throw new Error("Message is outside the confirmed mailbox.");
        }
      }
      await service.mutateMessage(mutation);
    });
    return apiSuccess(result);
  } catch (error) {
    return apiFailure(error, "Unable to update the selected messages.");
  }
};
