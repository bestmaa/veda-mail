import { createHash } from "node:crypto";

import { getMailService } from "@/server/mail/mail-service";
import type { OutgoingAttachment, SendMessageInput } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { getCurrentConnection } from "@/server/connections/connection-session";
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
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import { sendMessageSchema } from "@/transport/http/request-schemas";

export const runtime = "nodejs";

export const POST = async (request: Request) => {
  let memoryLease: AttachmentSendMemoryLease | undefined;
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "mail-send", 5_000, 300, 60 * 1000);
    const connection = await getCurrentConnection();
    assertSubjectRateLimit("mail-send", connection.id, 30, 60 * 1000);
    const parsed = sendMessageSchema.parse(await readJsonBody(request));
    const uploadIds = parsed.attachmentIds;
    const scope = parsed.draftId
      ? attachmentScope(connection, parsed.draftId)
      : null;
    const quarantine = attachmentService();
    let attachments: readonly OutgoingAttachment[] = [];
    if (uploadIds.length > 0 && scope) {
      const selected = await Promise.all(
        uploadIds.map((uploadId) => quarantine.inspect(uploadId, scope)),
      );
      await assertAttachmentCapability(
        connection,
        Math.max(...selected.map(({ contentLength }) => contentLength)),
      );
      memoryLease = await attachmentSendMemoryBudget().acquire(
        selected.reduce((total, { contentLength }) => total + contentLength, 0),
      );
      const claimed = await quarantine.claim(uploadIds, scope);
      const reads = await Promise.allSettled(
        claimed.map(async (attachment) => {
          const content = await quarantine.readClaimed(attachment.id, scope);
          return {
            content,
            id: id.attachmentUpload(attachment.id),
            mimeType: attachment.detectedMimeType ?? "application/octet-stream",
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
          uploadIds.map((uploadId) => quarantine.release([uploadId], scope)),
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
      body: parsed.body,
      cc: parsed.cc,
      ...(parsed.inReplyTo ? { inReplyTo: parsed.inReplyTo } : {}),
      subject: parsed.subject,
      to: parsed.to,
    };
    let receipt;
    try {
      receipt = await (await getMailService(connection)).sendMessage(input);
    } catch (error) {
      if (scope && uploadIds.length > 0) {
        await quarantine.release(uploadIds, scope).catch(() => {
          console.error("[veda-mail] Attachment claim release failed.");
        });
      }
      throw error;
    }
    if (scope && uploadIds.length > 0) {
      await quarantine.consume(uploadIds, scope).catch(() => {
        console.error("[veda-mail] Sent attachment cleanup failed.");
      });
    }
    return apiSuccess(receipt, { status: 201 });
  } catch (error) {
    return apiFailure(
      asAttachmentApiError(error),
      "Unable to send this message.",
    );
  } finally {
    memoryLease?.release();
  }
};
