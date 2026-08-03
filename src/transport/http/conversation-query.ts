import { z } from "zod";

import { id } from "@/domain/shared/brand";
import { ApiError } from "@/transport/http/api-error";

const ALLOWED_PARAMETERS = new Set(["cursor"]);
const cursorSchema = z.string().min(1).max(2_048);
const messageIdSchema = z.string().min(1).max(2_048).transform(id.message);

export const parseConversationQuery = (
  request: Request,
  messageId: string,
) => {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (!ALLOWED_PARAMETERS.has(key)) {
      throw new ApiError(
        "The conversation query contains an unsupported parameter.",
        "INVALID_CONVERSATION_QUERY",
        400,
      );
    }
  }
  const cursorValues = params.getAll("cursor");
  if (cursorValues.length > 1) {
    throw new ApiError(
      "The cursor parameter must be supplied once.",
      "INVALID_CONVERSATION_QUERY",
      400,
    );
  }
  const cursor = cursorValues[0];
  if (cursor === "") {
    throw new ApiError(
      "The cursor parameter cannot be empty.",
      "INVALID_CONVERSATION_QUERY",
      400,
    );
  }
  return {
    anchorMessageId: messageIdSchema.parse(messageId),
    ...(cursor ? { cursor: cursorSchema.parse(cursor) } : {}),
  };
};
