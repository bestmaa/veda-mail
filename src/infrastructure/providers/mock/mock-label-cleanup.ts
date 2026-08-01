import "server-only";

import { z } from "zod";

import {
  assertLabelCleanupInput,
  LabelCleanupCursorError,
  type LabelCleanupInput,
  type LabelCleanupResult,
} from "@/domain/mail/label";
import type { MessageDetail } from "@/domain/mail/mail";
import {
  decodeLabelCleanupCursor,
  encodeLabelCleanupCursor,
} from "@/infrastructure/providers/label-cleanup-cursor";

const CURSOR_SECRET = "mock-label-cleanup-cursor";

const cursorSchema = z.object({
  labelId: z.string(),
  provider: z.literal("mock"),
  version: z.literal(1),
}).strict();
const cursorPayload = (labelId: string) => ({
  labelId,
  provider: "mock",
  version: 1,
} as const);
const validateCursor = (input: LabelCleanupInput): void => {
  if (!input.cursor) return;
  try {
    const parsed = cursorSchema.parse(
      decodeLabelCleanupCursor(input.cursor, CURSOR_SECRET),
    );
    if (parsed.labelId !== input.labelId) {
      throw new Error("mismatch");
    }
  } catch {
    throw new LabelCleanupCursorError();
  }
};

export const cleanupMockLabel = (
  messages: MessageDetail[],
  input: LabelCleanupInput,
): LabelCleanupResult => {
  assertLabelCleanupInput(input);
  validateCursor(input);
  const targets = messages
    .map((message, index) => ({ index, message }))
    .filter(({ message }) => message.labelIds.includes(input.labelId))
    .slice(0, input.limit);
  for (const { index, message } of targets) {
    messages[index] = {
      ...message,
      labelIds: message.labelIds.filter((labelId) => labelId !== input.labelId),
    };
  }
  const complete = !messages.some((message) =>
    message.labelIds.includes(input.labelId),
  );
  return {
    complete,
    cursor: complete
      ? null
      : encodeLabelCleanupCursor(cursorPayload(input.labelId), CURSOR_SECRET),
    processed: targets.length,
    removed: targets.length,
  };
};
