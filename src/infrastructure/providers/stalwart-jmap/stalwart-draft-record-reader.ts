import "server-only";

import { z } from "zod";

import {
  DraftConflictError,
  DraftNotFoundError,
} from "@/domain/mail/draft-errors";
import type { DraftDetail } from "@/domain/mail/draft";
import type { ProviderDraftId } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { mapJmapDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.mapper";
import {
  jmapDraftEmailSchema,
  jmapDraftQueryResultSchema,
  type JmapDraftEmail,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import { jmapListResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import {
  JMAP_MAIL,
  MAX_JMAP_BODY_VALUE_BYTES,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const draftProperties = [
  "id",
  "mailboxIds",
  "keywords",
  "receivedAt",
  "subject",
  "from",
  "to",
  "cc",
  "bcc",
  "textBody",
  "htmlBody",
  "bodyValues",
  "attachments",
  "hasAttachment",
  "messageId",
  "inReplyTo",
  "references",
  "replyTo",
  "sender",
  "headers",
  "bodyStructure",
  "header:Bcc:asGroupedAddresses:all",
  "header:Cc:asGroupedAddresses:all",
  "header:From:asGroupedAddresses:all",
  "header:To:asGroupedAddresses:all",
] as const;
const presenceResultSchema = z
  .object({
    accountId: z.string().min(1).max(1_024),
    list: z.array(z.object({ id: z.string().min(1).max(1_024) })).max(1),
    notFound: z.array(z.string().min(1).max(1_024)).max(1),
    state: z.string().min(1).max(1_024),
  })
  .passthrough();
export const stalwartDraftGetResultSchema = jmapListResultSchema(
  jmapDraftEmailSchema,
).extend({
  notFound: z.array(z.string().min(1).max(1_024)).max(1_024).default([]),
});

export interface StalwartDraftContext {
  readonly accountId: string;
  readonly accountEmail?: string;
  readonly draftsMailboxId: string;
}

export interface StalwartDraftRecord {
  readonly detail: DraftDetail;
  readonly email: JmapDraftEmail;
  readonly state: string;
}

export const loadStalwartDraftRecord = async (
  client: StalwartJmapClient,
  context: StalwartDraftContext,
  providerDraftId: ProviderDraftId,
  requiredSendClaim?: string,
): Promise<StalwartDraftRecord> => {
  const response = await client.request(
    [
      [
        "Email/get",
        {
          accountId: context.accountId,
          bodyProperties: [
            "partId",
            "blobId",
            "size",
            "type",
            "headers",
            "charset",
            "disposition",
            "cid",
            "language",
            "location",
            "name",
            "subParts",
          ],
          fetchHTMLBodyValues: true,
          fetchTextBodyValues: true,
          ids: [providerDraftId],
          maxBodyValueBytes: MAX_JMAP_BODY_VALUE_BYTES,
          properties: draftProperties,
        },
        "draft",
      ],
    ],
    [JMAP_MAIL],
  );
  const result = client.result(
    response,
    "draft",
    "Email/get",
    stalwartDraftGetResultSchema,
  );
  const email = result.list.length === 1 ? result.list[0] : undefined;
  if (result.accountId !== context.accountId) throw new DraftConflictError();
  if (
    email?.id === providerDraftId &&
    result.list.length === 1 &&
    result.notFound.length === 0
  ) {
    return {
      detail: mapJmapDraft(
        email,
        context.accountId,
        context.draftsMailboxId,
        requiredSendClaim,
        context.accountEmail,
      ),
      email,
      state: result.state,
    };
  }
  if (
    result.list.length === 0 &&
    result.notFound.length === 1 &&
    result.notFound[0] === providerDraftId
  ) {
    throw new DraftNotFoundError();
  }
  throw new DraftConflictError();
};

export const isStalwartDraftPresent = async (
  client: StalwartJmapClient,
  context: StalwartDraftContext,
  providerDraftId: ProviderDraftId,
): Promise<boolean> => {
  const response = await client.request(
    [
      [
        "Email/get",
        {
          accountId: context.accountId,
          ids: [providerDraftId],
          properties: ["id"],
        },
        "draft-presence",
      ],
    ],
    [JMAP_MAIL],
  );
  const result = client.result(
    response,
    "draft-presence",
    "Email/get",
    presenceResultSchema,
  );
  if (result.accountId !== context.accountId) throw new DraftConflictError();
  if (
    result.list.length === 1 &&
    result.list[0]?.id === providerDraftId &&
    result.notFound.length === 0
  ) {
    return true;
  }
  if (
    result.list.length === 0 &&
    result.notFound.length === 1 &&
    result.notFound[0] === providerDraftId
  ) {
    return false;
  }
  throw new DraftConflictError();
};

export const findStalwartDraftByKeyword = async (
  client: StalwartJmapClient,
  context: StalwartDraftContext,
  keyword: string,
): Promise<StalwartDraftRecord | null> => {
  const response = await client.request(
    [
      [
        "Email/query",
        {
          accountId: context.accountId,
          calculateTotal: true,
          filter: {
            hasKeyword: keyword,
          },
          limit: 2,
        },
        "draft-operation-query",
      ],
    ],
    [JMAP_MAIL],
  );
  const result = client.result(
    response,
    "draft-operation-query",
    "Email/query",
    jmapDraftQueryResultSchema,
  );
  if (result.accountId !== context.accountId || result.position !== 0) {
    throw new DraftConflictError();
  }
  if (result.total === 0 && result.ids.length === 0) return null;
  if (result.total !== 1 || result.ids.length !== 1) {
    throw new DraftConflictError();
  }
  try {
    return await loadStalwartDraftRecord(
      client,
      context,
      result.ids[0] as ProviderDraftId,
    );
  } catch (error) {
    if (error instanceof DraftNotFoundError) throw new DraftConflictError();
    throw error;
  }
};
