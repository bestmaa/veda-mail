import "server-only";

import { id, type MessageId } from "@/domain/shared/brand";
import { MAX_MESSAGE_SOURCE_ARCHIVE_ENTRIES } from "@/server/mail/message-source-archive";
import { readJsonBody } from "@/transport/http/read-json-body";
import { z } from "zod";

const schema = z.object({
  messageIds: z.array(z.string().min(1).max(2_048).transform(id.message))
    .min(1).max(MAX_MESSAGE_SOURCE_ARCHIVE_ENTRIES),
}).strict().refine(({ messageIds }) => new Set(messageIds).size === messageIds.length);

export const parseMessageSourceArchiveRequest = async (
  request: Request,
): Promise<{ readonly messageIds: readonly MessageId[] }> =>
  schema.parse(await readJsonBody(request, 48 * 1024));
