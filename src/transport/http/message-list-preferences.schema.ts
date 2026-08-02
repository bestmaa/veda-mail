import { z } from "zod";

import {
  MESSAGE_LIST_DENSITIES,
  MESSAGE_LIST_SORTS,
  UNDO_SEND_DELAYS,
} from "@/domain/mail/message-list-preferences";

export const messageListPreferencesSchema = z
  .object({
    confirmBeforeSend: z.boolean(),
    density: z.enum(MESSAGE_LIST_DENSITIES),
    keyboardShortcuts: z.boolean(),
    showPreview: z.boolean(),
    sort: z.enum(MESSAGE_LIST_SORTS),
    undoSendSeconds: z.union(
      UNDO_SEND_DELAYS.map((delay) => z.literal(delay)),
    ),
  })
  .strict();
