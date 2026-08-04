import "server-only";

import { z } from "zod";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import {
  asCalendarPartId,
  type CalendarPart,
  type CalendarPartDownload,
  type CalendarPartDownloadInput,
  type CalendarPartListInput,
} from "@/domain/mail/calendar";
import { bindJmapReceivedAttachments } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-attachment";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  collectStalwartCalendarParts,
  findStalwartCalendarPart,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-calendar-part";
import { jmapListResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import {
  JMAP_MAIL,
  JMAP_RECEIVED_ATTACHMENT_BODY_PROPERTIES,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const calendarEmailSchema = z.object({
  bodyStructure: z.unknown(),
  id: z.string().min(1).max(1_024),
}).passthrough();

const calendarError = (
  code: ConstructorParameters<typeof AttachmentDownloadError>[0],
  message: string,
): AttachmentDownloadError => new AttachmentDownloadError(code, message);

const normalizeError = (
  error: unknown,
  signal?: AbortSignal,
): AttachmentDownloadError => {
  if (error instanceof AttachmentDownloadError) return error;
  if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
    return calendarError("aborted", "The calendar invitation lookup was cancelled.");
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return calendarError("timeout", "The mail provider calendar lookup timed out.");
  }
  return calendarError(
    "provider_failure",
    "The mail provider could not read calendar invitation parts.",
  );
};

const getCalendarEmail = async (
  client: StalwartJmapClient,
  accountId: string,
  input: CalendarPartListInput,
) => {
  try {
    const response = await client.request(
      [["Email/get", {
        accountId,
        bodyProperties: JMAP_RECEIVED_ATTACHMENT_BODY_PROPERTIES,
        ids: [input.messageId],
        properties: ["id", "bodyStructure"],
      }, "calendar-email"]],
      [JMAP_MAIL],
      input.signal,
    );
    const result = client.result(
      response,
      "calendar-email",
      "Email/get",
      jmapListResultSchema(calendarEmailSchema),
    );
    const email = result.list[0];
    if (
      result.accountId !== accountId ||
      result.list.length !== 1 ||
      email?.id !== input.messageId
    ) {
      throw calendarError("not_found", "Calendar invitation not found.");
    }
    return email;
  } catch (error) {
    throw normalizeError(error, input.signal);
  }
};

export const listStalwartCalendarParts = async (
  client: StalwartJmapClient,
  accountId: string,
  input: CalendarPartListInput,
): Promise<readonly CalendarPart[]> => {
  const email = await getCalendarEmail(client, accountId, input);
  try {
    return collectStalwartCalendarParts(
      accountId,
      input.messageId,
      email.bodyStructure,
    ).map(({ id, name, size }) => ({
      id: asCalendarPartId(id),
      mimeType: "text/calendar" as const,
      name,
      size,
    }));
  } catch (error) {
    throw normalizeError(error, input.signal);
  }
};

export const downloadStalwartCalendarPart = async (
  client: StalwartJmapClient,
  accountId: string,
  input: CalendarPartDownloadInput,
): Promise<CalendarPartDownload> => {
  const email = await getCalendarEmail(client, accountId, input);
  let calendar;
  try {
    calendar = findStalwartCalendarPart(
      accountId,
      input.messageId,
      email.bodyStructure,
      input.calendarPartId,
    );
  } catch (error) {
    throw normalizeError(error, input.signal);
  }
  if (!calendar) {
    throw calendarError("not_found", "Calendar invitation not found.");
  }
  const attachment = bindJmapReceivedAttachments(accountId, {
    attachments: [calendar.part],
    htmlBody: [],
    id: input.messageId,
  })[0];
  if (!attachment) {
    throw calendarError("not_found", "Calendar invitation not found.");
  }
  try {
    const downloaded = await client.downloadAttachment({
      accountId,
      attachment,
      maxBytes: input.maxBytes,
      messageId: input.messageId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return {
      body: downloaded.body,
      mimeType: "text/calendar",
      name: calendar.name,
      size: calendar.size,
    };
  } catch (error) {
    throw normalizeError(error, input.signal);
  }
};
