import "server-only";

import { z } from "zod";

import {
  asCalendarPartId,
  type CalendarReplyParticipationStatus,
} from "@/domain/mail/calendar";
import { id } from "@/domain/shared/brand";
import { CalendarParseError } from "@/server/calendar/calendar-parser";
import { ApiError } from "@/transport/http/api-error";

export const MAX_CALENDAR_RESPONSE_REQUEST_BYTES = 8 * 1024;

const identifier = z.string().min(1).max(2_048).regex(
  /^[A-Za-z0-9_-]+$/u,
  "Identifier is invalid.",
);

const routeParamsSchema = z.object({ messageId: identifier }).strict();

const responseSchema = z.object({
  idempotencyKey: z.string().uuid(),
  partId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/u),
  response: z.enum(["accepted", "declined", "tentative"]),
}).strict();

export const parseCalendarRouteParams = (input: unknown) => {
  const parsed = routeParamsSchema.parse(input);
  return { messageId: id.message(parsed.messageId) };
};

export const parseCalendarResponse = (input: unknown) => {
  const parsed = responseSchema.parse(input);
  const participationStatus: CalendarReplyParticipationStatus =
    parsed.response === "accepted"
      ? "ACCEPTED"
      : parsed.response === "declined"
        ? "DECLINED"
        : "TENTATIVE";
  return {
    idempotencyKey: parsed.idempotencyKey,
    partId: asCalendarPartId(parsed.partId),
    participationStatus,
    response: parsed.response,
  };
};

export const asCalendarApiError = (error: unknown): unknown =>
  error instanceof CalendarParseError
    ? new ApiError(
        "The calendar invitation is malformed or unsupported.",
        "CALENDAR_INVITATION_INVALID",
        422,
      )
    : error;
