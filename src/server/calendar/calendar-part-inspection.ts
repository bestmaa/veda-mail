import "server-only";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import type {
  CalendarInvitation,
  CalendarPart,
  CalendarPartId,
} from "@/domain/mail/calendar";
import type { ConnectionId, MessageId } from "@/domain/shared/brand";
import { parseCalendarInvitation } from "@/server/calendar/calendar-parser";
import { asReceivedAttachmentScanApiError } from "@/server/mail/received-attachment-scan-http";
import { stageReceivedAttachmentDownload } from "@/server/mail/received-attachment-scan-operation";
import { receivedAttachmentScanSpool } from "@/server/mail/received-attachment-scan-service";
import { ApiError } from "@/transport/http/api-error";

export const MAX_CALENDAR_PART_BYTES = 1024 * 1024;
export const MAX_CALENDAR_PARTS_PER_MESSAGE = 8;

const readBytes = async (
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> => {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        throw new ApiError(
          "The calendar invitation exceeds the inspection limit.",
          "CALENDAR_PART_TOO_LARGE",
          413,
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

export interface CalendarPartInspection {
  readonly invitation: CalendarInvitation;
  readonly part: CalendarPart;
}

type CalendarPartDownloadGateway = Pick<MailGateway, "downloadCalendarPart">;

export const inspectCalendarPart = async (
  gateway: CalendarPartDownloadGateway,
  connectionId: ConnectionId,
  messageId: MessageId,
  part: CalendarPart,
  signal?: AbortSignal,
): Promise<CalendarPartInspection> => {
  const download = await gateway.downloadCalendarPart({
    calendarPartId: part.id,
    maxBytes: MAX_CALENDAR_PART_BYTES,
    messageId,
    ...(signal ? { signal } : {}),
  });
  let prepared;
  try {
    prepared = await stageReceivedAttachmentDownload(
      download,
      { attachmentId: part.id, connectionId, messageId },
      await receivedAttachmentScanSpool(),
      signal,
    );
    if (prepared.mimeType !== "text/calendar") {
      throw new ApiError(
        "The selected message part is not a calendar invitation.",
        "CALENDAR_PART_TYPE_INVALID",
        422,
      );
    }
    const clean = await prepared.open(signal);
    const bytes = await readBytes(clean.body, MAX_CALENDAR_PART_BYTES);
    return { invitation: parseCalendarInvitation(bytes), part };
  } catch (error) {
    throw asReceivedAttachmentScanApiError(error);
  } finally {
    await prepared?.dispose().catch(() => undefined);
  }
};

export const findCalendarPart = (
  parts: readonly CalendarPart[],
  partId: CalendarPartId,
): CalendarPart => {
  const part = parts.find(({ id }) => id === partId);
  if (!part) {
    throw new ApiError(
      "The calendar invitation was not found.",
      "CALENDAR_PART_NOT_FOUND",
      404,
    );
  }
  return part;
};
