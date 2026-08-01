import { z } from "zod";

import {
  MESSAGE_LIST_DENSITIES,
  MESSAGE_LIST_SORTS,
} from "@/domain/mail/message-list-preferences";

export const messageListPreferencesSchema = z
  .object({
    density: z.enum(MESSAGE_LIST_DENSITIES),
    showPreview: z.boolean(),
    sort: z.enum(MESSAGE_LIST_SORTS),
  })
  .strict();
