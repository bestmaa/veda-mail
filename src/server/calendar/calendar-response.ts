import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { MailApplicationService } from "@/application/services/mail-application.service";
import type {
  CalendarPartId,
  CalendarReplyParticipationStatus,
} from "@/domain/mail/calendar";
import type { SendMessageInput, SendReceipt } from "@/domain/mail/mail";
import { canonicalizeSendReceipt } from "@/domain/mail/send-receipt";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id, type MessageId } from "@/domain/shared/brand";
import {
  findCalendarPart,
  inspectCalendarPart,
  MAX_CALENDAR_PARTS_PER_MESSAGE,
} from "@/server/calendar/calendar-part-inspection";
import { serializeCalendarReply } from "@/server/calendar/calendar-serializer";
import {
  completeIdempotentSend,
  failIdempotentSend,
  prepareIdempotentSend,
} from "@/server/mail/send-idempotency";
import { ApiError } from "@/transport/http/api-error";

interface CalendarResponseInput {
  readonly connection: ProviderConnection;
  readonly gateway: MailApplicationService;
  readonly idempotencyKey: string;
  readonly messageId: MessageId;
  readonly partId: CalendarPartId;
  readonly participationStatus: CalendarReplyParticipationStatus;
  readonly signal?: AbortSignal;
}

const label = (status: CalendarReplyParticipationStatus): string =>
  status === "ACCEPTED"
    ? "Accepted"
    : status === "DECLINED"
      ? "Declined"
      : "Tentative";

const responseDraftId = (input: CalendarResponseInput): ReturnType<typeof id.draft> =>
  id.draft(`calendar-${createHash("sha256").update([
    input.messageId,
    input.partId,
    input.participationStatus,
    input.idempotencyKey,
  ].join("\0")).digest("hex")}`);

export const respondToCalendarInvitation = async (
  input: CalendarResponseInput,
) => {
  const [account, parts] = await Promise.all([
    input.gateway.getAccount(),
    input.gateway.listCalendarParts({
      messageId: input.messageId,
      ...(input.signal ? { signal: input.signal } : {}),
    }),
  ]);
  if (parts.length > MAX_CALENDAR_PARTS_PER_MESSAGE) {
    throw new ApiError(
      "This message contains too many calendar parts to answer safely.",
      "CALENDAR_PART_LIMIT_EXCEEDED",
      422,
    );
  }
  const inspected = await inspectCalendarPart(
    input.gateway,
    input.connection.id,
    input.messageId,
    findCalendarPart(parts, input.partId),
    input.signal,
  );
  const organizer = inspected.invitation.event.organizer;
  if (inspected.invitation.method !== "REQUEST" || !organizer) {
    throw new ApiError(
      "Only a calendar REQUEST with an organizer can be answered.",
      "CALENDAR_RESPONSE_NOT_ALLOWED",
      422,
    );
  }
  const ics = serializeCalendarReply({
    attendeeEmail: account.email,
    invitation: inspected.invitation,
    participationStatus: input.participationStatus,
  });
  const content = Buffer.from(ics, "utf8");
  const digest = createHash("sha256").update(content).digest("hex");
  const statusLabel = label(input.participationStatus);
  const message: SendMessageInput = {
    attachments: [{
      calendarMethod: "REPLY",
      content,
      id: id.attachmentUpload(`calendar-${digest}`),
      mimeType: "text/calendar",
      name: "reply.ics",
      sha256: digest,
      size: content.byteLength,
    }],
    bcc: [],
    body: `${statusLabel}: ${inspected.invitation.event.summary}`,
    cc: [],
    inReplyTo: input.messageId,
    subject: `Re: ${inspected.invitation.event.summary}`,
    to: [{ email: organizer.email, name: organizer.name }],
  };
  const prepared = await prepareIdempotentSend(
    input.connection,
    responseDraftId(input),
    {
      attachmentIds: message.attachments?.map(({ id }) => id) ?? [],
      bcc: [], body: message.body, cc: [],
      htmlBody: null,
      inReplyTo: input.messageId,
      subject: message.subject, to: message.to,
    },
  );
  let receipt: SendReceipt;
  if (prepared.kind === "replay") receipt = prepared.receipt;
  else {
    try {
      const provider: unknown = await input.gateway.sendMessage(message);
      receipt = canonicalizeSendReceipt(message, provider, {
        deliveryNoticeId: randomUUID(),
        id: id.message(`calendar-receipt-${randomUUID()}`),
        submittedAt: new Date().toISOString(),
      });
      receipt = await completeIdempotentSend(input.connection, prepared.owner, receipt);
    } catch (error) {
      await failIdempotentSend(input.connection, prepared.owner, error);
      throw error;
    }
  }
  return {
    partId: input.partId,
    receipt,
    response: input.participationStatus,
    sequence: inspected.invitation.event.sequence,
    uid: inspected.invitation.event.uid,
  };
};
