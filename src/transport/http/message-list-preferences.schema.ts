import { z } from "zod";

import {
  MESSAGE_LIST_DENSITIES,
  MAIL_LOCALES,
  MESSAGE_LIST_SORTS,
  UNDO_SEND_DELAYS,
} from "@/domain/mail/message-list-preferences";

const timeZoneSchema = z.string().trim().min(1).max(128).refine((value) => {
  if (value === "auto") return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}, "Choose a valid IANA time zone.");

export const messageListPreferencesSchema = z
  .object({
    confirmBeforeSend: z.boolean(),
    density: z.enum(MESSAGE_LIST_DENSITIES),
    keyboardShortcuts: z.boolean(),
    locale: z.enum(MAIL_LOCALES),
    showPreview: z.boolean(),
    sort: z.enum(MESSAGE_LIST_SORTS),
    timeZone: timeZoneSchema,
    undoSendSeconds: z.union(
      UNDO_SEND_DELAYS.map((delay) => z.literal(delay)),
    ),
  })
  .strict();

export const messageListPreferencesUpdateSchema = messageListPreferencesSchema
  .omit({ locale: true, timeZone: true })
  .extend({
    locale: messageListPreferencesSchema.shape.locale.optional(),
    timeZone: messageListPreferencesSchema.shape.timeZone.optional(),
  })
  .strict();
