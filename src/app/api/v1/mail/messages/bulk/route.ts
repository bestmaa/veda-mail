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
  authorizeMessageMoveMailboxes,
  authorizeMessageMoveMembership,
} from "@/server/messages/message-move.service";
import { labelHttpError } from "@/server/labels/label-http";
import { mutateBulkMessageLabels } from "@/server/labels/label-operation.service";
import { mailboxOwner } from "@/server/mailboxes/mailbox-http";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { memberAuditActor } from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
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
  if (request.type === "set-label") {
    return {
      labelId: request.labelId,
      messageId,
      type: request.type,
      value: request.value,
    };
  }
  if (request.type === "destroy") {
    return { mailboxId: request.mailboxId, messageId, type: request.type };
  }
  if (request.type === "move") {
    return {
      destinationMailboxId: request.destinationMailboxId,
      messageId,
      sourceMailboxId: request.sourceMailboxId,
      type: request.type,
    };
  }
  return { messageId, type: request.type };
};

const runBounded = async (
  request: BulkMessageMutation,
  mutate: (mutation: MessageMutation) => Promise<void>,
): Promise<BulkMessageMutationResult> => {
  const outcomes = new Array<"failed" | "succeeded" | "unconfirmed">(
    request.messageIds.length,
  ).fill("unconfirmed");
  let cursor = 0;
  const worker = async () => {
    while (cursor < request.messageIds.length) {
      const index = cursor++;
      const messageId = request.messageIds[index];
      if (!messageId) continue;
      try {
        await mutate(mutationFor(request, messageId));
        outcomes[index] = "succeeded";
      } catch (error) {
        outcomes[index] = error instanceof ApiError &&
          error.status >= 400 && error.status < 500
          ? "failed"
          : "unconfirmed";
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, request.messageIds.length) }, worker),
  );
  const failed: MessageId[] = [];
  const succeeded: MessageId[] = [];
  const unconfirmed: MessageId[] = [];
  for (let index = 0; index < request.messageIds.length; index += 1) {
    const messageId = request.messageIds[index];
    if (!messageId) continue;
    if (outcomes[index] === "failed") failed.push(messageId);
    else if (outcomes[index] === "succeeded") succeeded.push(messageId);
    else unconfirmed.push(messageId);
  }
  return {
    // Keep unconfirmed IDs in `failed` for rolling clients that predate the
    // richer outcome. New clients subtract the explicit subset after validation.
    failed: request.messageIds.filter(
      (_, index) => outcomes[index] !== "succeeded",
    ),
    succeeded,
    ...(unconfirmed.length ? { unconfirmed } : {}),
  };
};

export const PATCH = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
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
      audit = securityAuditOperation({
        action: "messages.destroyed",
        actor: memberAuditActor(connection),
        count: payload.messageIds.length,
        targetType: "messages",
      });
      await audit.attempt();
    }
    if (payload.type === "set-label") {
      const result = await mutateBulkMessageLabels(
        service,
        await mailboxOwner(service),
        payload,
      );
      return apiSuccess(result);
    }
    const mutate = async (): Promise<BulkMessageMutationResult> => {
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
        if (source.rights.mayRemoveItems !== true) {
          throw new ApiError(
            "The mail provider does not allow permanent deletion from this mailbox.",
            "PERMANENT_DELETE_RIGHTS_FORBIDDEN",
            403,
          );
        }
      }
      const moveContext = payload.type === "move"
        ? authorizeMessageMoveMailboxes(await service.listMailboxes(), payload)
        : null;
      return runBounded(payload, async (mutation) => {
        if (mutation.type === "destroy") {
          const message = await service.getMessage(mutation.messageId);
          if (!message.mailboxIds.includes(mutation.mailboxId)) {
            throw new ApiError(
              "Message is outside the confirmed mailbox.",
              "PERMANENT_DELETE_SOURCE_STALE",
              409,
            );
          }
        }
        if (mutation.type === "move" && moveContext) {
          authorizeMessageMoveMembership(
            await service.getMessage(mutation.messageId),
            moveContext,
          );
        }
        await service.mutateMessage(mutation);
      });
    };
    const result = await mutate();
    if (audit) {
      audit.applied();
      const uncertain = result.failed.length > 0 || (result.unconfirmed?.length ?? 0) > 0;
      if (uncertain) await audit.partial(result.succeeded.length);
      else await audit.success(result.succeeded.length);
    }
    return apiSuccess(result);
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(labelHttpError(error), "Unable to update the selected messages.");
  }
};
