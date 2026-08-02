import "server-only";

import { ApiError } from "@/transport/http/api-error";

export const scheduledSendUnavailable = (): never => {
  throw new ApiError(
    "Scheduled send is not configured on this server.",
    "SCHEDULED_SEND_UNAVAILABLE",
    503,
  );
};

export const scheduledMessageNotFound = (): never => {
  throw new ApiError(
    "This scheduled message was not found.",
    "SCHEDULED_MESSAGE_NOT_FOUND",
    404,
  );
};

export const scheduledMessageBusy = (): never => {
  throw new ApiError(
    "This message is already being sent and can no longer be changed.",
    "SCHEDULED_MESSAGE_BUSY",
    409,
  );
};

export const scheduledMessageConflict = (): never => {
  throw new ApiError(
    "This draft is already scheduled.",
    "SCHEDULED_MESSAGE_CONFLICT",
    409,
  );
};

export const scheduledMessageCapacity = (): never => {
  throw new ApiError(
    "This mailbox has reached its scheduled-message limit.",
    "SCHEDULED_MESSAGE_LIMIT_REACHED",
    422,
  );
};
