import { createHash, randomUUID } from "node:crypto";

import { MessageDeliveryRejectedError } from "@/domain/mail/mail-errors";
import { canonicalizeSendReceipt } from "@/domain/mail/send-receipt";
import { getMailService } from "@/server/mail/mail-service";
import type {
  OutgoingAttachment,
  SendMessageInput,
  SendReceipt,
} from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { connectionStore } from "@/server/connections/connection-store";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  asAttachmentApiError,
  assertAttachmentCapability,
  attachmentScope,
  attachmentService,
} from "@/server/mail/attachment-service";
import {
  attachmentSendMemoryBudget,
  type AttachmentSendMemoryLease,
} from "@/server/mail/attachment-send-memory-budget";
import { asDraftDomainApiError } from "@/server/mail/draft-http";
import {
  completeIdempotentSend,
  failIdempotentSend,
  prepareIdempotentSend,
} from "@/server/mail/send-idempotency";
import { canonicalizeOutgoingMailContent } from "@/server/mail/outgoing-mail-content";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import { sendMessageSchema } from "@/transport/http/request-schemas";
import { ZodError } from "zod";

export const runtime = "nodejs";

const MAX_RECIPIENTS_PER_CONNECTION_PER_MINUTE = 300;

const asSendMessageApiError = (error: unknown): unknown => {
  if (error instanceof MessageDeliveryRejectedError) {
    return new ApiError(
      "The mail provider rejected every recipient. Check the addresses and try again.",
      "MAIL_RECIPIENTS_REJECTED",
      422,
    );
  }
  const draftError = asDraftDomainApiError(error);
  if (draftError) return draftError;
  const mapped = asAttachmentApiError(error);
  return mapped instanceof ApiError || mapped instanceof ZodError
    ? mapped
    : new ApiError(
        "The mail provider could not complete this send.",
        "MAIL_SEND_FAILED",
        503,
      );
};

export const POST = async (request: Request) => {
  let memoryLease: AttachmentSendMemoryLease | undefined;
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "mail-send", 5_000, 300, 60 * 1000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("mail-send", connection.id, 30, 60 * 1000);
    const parsed = sendMessageSchema.parse(await readJsonBody(request));
    const content = canonicalizeOutgoingMailContent(parsed);
    const providerDraft =
      parsed.providerDraftId && parsed.expectedDraftRevision
        ? {
            composeId: parsed.draftId,
            expectedRevision: parsed.expectedDraftRevision,
            id: parsed.providerDraftId,
          }
        : undefined;
    assertSubjectRateLimit(
      "mail-send-recipient",
      connection.id,
      MAX_RECIPIENTS_PER_CONNECTION_PER_MINUTE,
      60 * 1000,
      parsed.to.length + parsed.cc.length + parsed.bcc.length,
    );
    const prepared = await prepareIdempotentSend(
      connection,
      parsed.draftId,
      {
        attachmentIds: parsed.attachmentIds,
        bcc: parsed.bcc,
        body: content.body,
        cc: parsed.cc,
        htmlBody: content.htmlBody ?? null,
        ...(parsed.inReplyTo ? { inReplyTo: parsed.inReplyTo } : {}),
        ...(providerDraft
          ? {
              providerDraft: {
                expectedRevision: providerDraft.expectedRevision,
                id: providerDraft.id,
              },
            }
          : {}),
        subject: parsed.subject,
        to: parsed.to,
      },
    );
    if (prepared.kind === "replay") {
      return apiSuccess(prepared.receipt, { status: 201 });
    }
    const { owner } = prepared;
    try {
      const uploadIds = parsed.attachmentIds;
      const scope = attachmentScope(connection, parsed.draftId);
      const quarantine = attachmentService();
      let attachments: readonly OutgoingAttachment[] = [];
      if (uploadIds.length > 0) {
        const selected = await Promise.all(
          uploadIds.map((uploadId) => quarantine.inspect(uploadId, scope)),
        );
        await assertAttachmentCapability(
          connection,
          Math.max(...selected.map(({ contentLength }) => contentLength)),
        );
        memoryLease = await attachmentSendMemoryBudget().acquire(
          selected.reduce(
            (total, { contentLength }) => total + contentLength,
            0,
          ),
        );
        const claimed = await quarantine.claim(uploadIds, scope);
        const reads = await Promise.allSettled(
          claimed.map(async (attachment) => {
            const content = await quarantine.readClaimed(attachment.id, scope);
            return {
              content,
              id: id.attachmentUpload(attachment.id),
              mimeType:
                attachment.detectedMimeType ?? "application/octet-stream",
              name: attachment.fileName,
              sha256: createHash("sha256").update(content).digest("hex"),
              size: attachment.contentLength,
            };
          }),
        );
        const failedRead = reads.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        if (failedRead) {
          await Promise.allSettled(
            uploadIds.map((uploadId) =>
              quarantine.release([uploadId], scope),
            ),
          );
          throw failedRead.reason;
        }
        attachments = reads.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
      }
      const input: SendMessageInput = {
        attachments,
        bcc: parsed.bcc,
        body: content.body,
        cc: parsed.cc,
        ...(content.htmlBody ? { htmlBody: content.htmlBody } : {}),
        ...(parsed.inReplyTo ? { inReplyTo: parsed.inReplyTo } : {}),
        ...(providerDraft ? { providerDraft } : {}),
        subject: parsed.subject,
        to: parsed.to,
      };
      let receipt: SendReceipt;
      try {
        const providerReceipt: unknown = await (
          await getMailService(connection)
        ).sendMessage(input);
        receipt = canonicalizeSendReceipt(input, providerReceipt, {
          deliveryNoticeId: randomUUID(),
          id: id.message(`receipt-${randomUUID()}`),
          submittedAt: new Date().toISOString(),
        });
        receipt = completeIdempotentSend(connection, owner, receipt);
      } catch (error) {
        if (uploadIds.length > 0) {
          await quarantine.release(uploadIds, scope).catch(() => {
            console.error("[veda-mail] Attachment claim release failed.");
          });
        }
        throw error;
      }
      try {
        if (receipt.deliveryStatus !== "accepted") {
          connectionStore.appendDeliveryNoticeIfActive(connection, receipt);
        }
      } catch {
        console.error("[veda-mail] Delivery notice persistence failed.");
      }
      if (uploadIds.length > 0) {
        await quarantine.consume(uploadIds, scope).catch(() => {
          console.error("[veda-mail] Sent attachment cleanup failed.");
        });
      }
      return apiSuccess(receipt, { status: 201 });
    } catch (error) {
      failIdempotentSend(connection, owner, error);
      throw error;
    }
  } catch (error) {
    return apiFailure(asSendMessageApiError(error), "Unable to send this message.");
  } finally {
    memoryLease?.release();
  }
};
