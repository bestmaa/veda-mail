import {
  combinedOutgoingContentWithinLimit,
  outgoingContentString,
} from "@/transport/http/outgoing-content-schema";
import { id, type AttachmentId } from "@/domain/shared/brand";
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

const attachmentIdSchema = z.string().min(1).max(2_048);
const retainedAttachmentIdSchema = attachmentIdSchema.transform(id.attachment);
const attachmentSelectionSchema = {
  attachmentIds: z.array(attachmentIdSchema).max(10).default([]),
  retainedAttachmentIds: z.array(retainedAttachmentIdSchema).max(10).default([]),
};

const uniqueAttachmentSelection = (
  input: { readonly attachmentIds: readonly string[];
    readonly retainedAttachmentIds: readonly AttachmentId[] },
  context: z.RefinementCtx,
) => {
  if (new Set(input.attachmentIds).size !== input.attachmentIds.length) {
    context.addIssue({ code: "custom", message: "Attachment uploads must be unique.",
      path: ["attachmentIds"] });
  }
  if (new Set(input.retainedAttachmentIds).size !==
    input.retainedAttachmentIds.length) {
    context.addIssue({ code: "custom", message: "Saved attachments must be unique.",
      path: ["retainedAttachmentIds"] });
  }
  if (input.attachmentIds.length + input.retainedAttachmentIds.length > 10) {
    context.addIssue({ code: "custom",
      message: "A draft can contain at most 10 attachments.",
      path: ["attachmentIds"] });
  }
};

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
    ...attachmentSelectionSchema,
    composeId: composeDraftIdSchema,
    content: draftContentSchema,
  })
  .strict()
  .superRefine((input, context) => {
    uniqueAttachmentSelection(input, context);
    if (input.retainedAttachmentIds.length > 0) {
      context.addIssue({ code: "custom",
        message: "A new draft cannot retain provider attachments.",
        path: ["retainedAttachmentIds"] });
    }
  });

export const updateDraftSchema = z
  .object({
    ...attachmentSelectionSchema,
    composeId: composeDraftIdSchema,
    content: draftContentSchema,
    expectedRevision: draftRevisionSchema,
  })
  .strict()
  .superRefine(uniqueAttachmentSelection);

export const deleteDraftSchema = z
  .object({ expectedRevision: draftRevisionSchema })
  .strict();
