import { id } from "@/domain/shared/brand";
import { sendMessageSchema } from "@/transport/http/request-schemas";
import { z } from "zod";

const scheduledAtSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

const durableSendRequestSchema = sendMessageSchema.superRefine(
  (request, context) => {
    if (request.attachmentIds.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Save attachments into the provider draft before scheduling.",
        path: ["attachmentIds"],
      });
    }
    if (!request.providerDraftId || !request.expectedDraftRevision) {
      context.addIssue({
        code: "custom",
        message: "Save the provider draft before scheduling this message.",
        path: ["providerDraftId"],
      });
    }
  },
);

export const createScheduledSendSchema = z
  .object({
    purpose: z.enum(["scheduled", "undo"]).default("scheduled"),
    request: durableSendRequestSchema,
    scheduledAt: scheduledAtSchema,
  })
  .strict();

export const rescheduleMessageSchema = z
  .object({ scheduledAt: scheduledAtSchema })
  .strict();

export const scheduledMessageIdSchema = z
  .string()
  .uuid("The scheduled-message identifier is invalid.")
  .transform((value) => id.scheduledMessage(value.toLowerCase()));
