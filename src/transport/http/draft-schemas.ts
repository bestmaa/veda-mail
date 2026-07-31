import {
  combinedOutgoingContentWithinLimit,
  outgoingContentString,
} from "@/transport/http/outgoing-content-schema";
import {
  composeDraftIdSchema,
  draftRevisionSchema,
} from "@/transport/http/draft-reference-schemas";
import {
  mailSubjectSchema,
  recipientListSchema,
  replyMessageIdSchema,
  uniqueMailAddresses,
} from "@/transport/http/request-schemas";
import { z } from "zod";

export const MAX_DRAFT_REQUEST_BYTES = 1024 * 1024;

export {
  composeDraftIdSchema,
  draftRevisionSchema,
  providerDraftIdSchema,
} from "@/transport/http/draft-reference-schemas";

export const draftContentSchema = z
  .object({
    bcc: recipientListSchema.default([]),
    body: outgoingContentString("Draft body").default(""),
    cc: recipientListSchema.default([]),
    htmlBody: outgoingContentString("Rich draft body").optional(),
    inReplyTo: replyMessageIdSchema.optional(),
    subject: mailSubjectSchema.default(""),
    to: recipientListSchema.default([]),
  })
  .strict()
  .superRefine((draft, context) => {
    if (!combinedOutgoingContentWithinLimit(draft.body, draft.htmlBody)) {
      context.addIssue({
        code: "custom",
        message:
          "Combined draft content cannot exceed 512,000 characters or UTF-8 bytes.",
        path: ["htmlBody"],
      });
    }
    if (draft.to.length + draft.cc.length + draft.bcc.length > 100) {
      context.addIssue({
        code: "custom",
        message:
          "A draft can have at most 100 recipients across To, CC, and BCC.",
        path: ["to"],
      });
    }
  })
  .transform((draft) => {
    const seen = new Set<string>();
    return {
      ...draft,
      to: uniqueMailAddresses(draft.to, seen),
      cc: uniqueMailAddresses(draft.cc, seen),
      bcc: uniqueMailAddresses(draft.bcc, seen),
    };
  });

export const createDraftSchema = z
  .object({
    composeId: composeDraftIdSchema,
    content: draftContentSchema,
  })
  .strict();

export const updateDraftSchema = z
  .object({
    composeId: composeDraftIdSchema,
    content: draftContentSchema,
    expectedRevision: draftRevisionSchema,
  })
  .strict();

export const deleteDraftSchema = z
  .object({ expectedRevision: draftRevisionSchema })
  .strict();
