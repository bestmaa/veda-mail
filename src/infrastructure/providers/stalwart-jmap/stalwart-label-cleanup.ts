import "server-only";

import { z } from "zod";

import {
  assertLabelCleanupInput,
  LabelCleanupCursorError,
  type LabelCleanupInput,
  type LabelCleanupResult,
} from "@/domain/mail/label";
import { id } from "@/domain/shared/brand";
import {
  decodeLabelCleanupCursor,
  encodeLabelCleanupCursor,
} from "@/infrastructure/providers/label-cleanup-cursor";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import {
  jmapIdBooleanRecordSchema,
  jmapKeywordBooleanRecordSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-record.schema";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const cursorSchema = z.object({
  labelId: z.string(),
  provider: z.literal("jmap"),
  version: z.literal(1),
}).strict();
const querySchema = z.object({
  accountId: z.string().min(1).max(255),
  ids: z.array(z.string().min(1).max(255)).max(100),
  position: z.literal(0),
  queryState: z.string().min(1).max(1_024),
}).passthrough();
const sourceSchema = z.object({
  accountId: z.string().min(1).max(255),
  list: z.array(z.object({
    id: z.string().min(1).max(255),
    keywords: jmapKeywordBooleanRecordSchema,
    mailboxIds: jmapIdBooleanRecordSchema,
  }).passthrough()).max(100),
  notFound: z.array(z.string().min(1).max(255)).max(100),
  state: z.string().min(1).max(1_024),
}).passthrough();

const cursorPayload = (labelId: string) => ({
  labelId,
  provider: "jmap",
  version: 1,
} as const);

const validateCursor = (input: LabelCleanupInput, cursorSecret: string): void => {
  if (!input.cursor) return;
  try {
    const parsed = cursorSchema.parse(
      decodeLabelCleanupCursor(input.cursor, cursorSecret),
    );
    if (parsed.labelId !== input.labelId) {
      throw new Error("mismatch");
    }
  } catch {
    throw new LabelCleanupCursorError();
  }
};

const queryIds = async (
  client: StalwartJmapClient,
  accountId: string,
  labelId: string,
  limit: number,
  callId: string,
): Promise<readonly string[]> => {
  const response = await client.request([["Email/query", {
    accountId,
    filter: { hasKeyword: labelId },
    limit,
    position: 0,
  }, callId]], [JMAP_MAIL]);
  const result = client.result(response, callId, "Email/query", querySchema);
  if (result.accountId !== accountId) {
    throw new Error("Stalwart returned label cleanup data for another account.");
  }
  if (result.ids.length > limit || new Set(result.ids).size !== result.ids.length) {
    throw new Error("Stalwart returned an invalid label cleanup query.");
  }
  return result.ids;
};

const cleanupBatch = async (
  client: StalwartJmapClient,
  reader: StalwartMailReader,
  accountId: string,
  input: LabelCleanupInput,
  messageIds: readonly string[],
): Promise<number> => {
  const response = await client.request([["Email/get", {
    accountId,
    ids: messageIds,
    properties: ["id", "keywords", "mailboxIds"],
  }, "label-cleanup-source"]], [JMAP_MAIL]);
  const source = client.result(
    response, "label-cleanup-source", "Email/get", sourceSchema,
  );
  const returnedIds = new Set(source.list.map((message) => message.id));
  if (
    source.accountId !== accountId ||
    source.notFound.length > 0 ||
    messageIds.some((messageId) => !returnedIds.has(messageId)) ||
    source.list.some((message) => !messageIds.includes(message.id)) ||
    returnedIds.size !== source.list.length
  ) {
    throw new StalwartJmapMethodError({ type: "stateMismatch" });
  }
  const targets = source.list.filter(
    (message) => message.keywords[input.labelId] === true,
  );
  const snapshot = await reader.getMailboxSnapshot();
  const rights = new Map(snapshot.mailboxes.map((mailbox) => [mailbox.id, mailbox.rights]));
  if (snapshot.accountId !== accountId || targets.some((message) => {
    const containing = Object.entries(message.mailboxIds)
      .filter(([, present]) => present)
      .map(([mailboxId]) => id.mailbox(mailboxId));
    return containing.length === 0 || containing.some(
      (mailboxId) => rights.get(mailboxId)?.maySetKeywords !== true,
    );
  })) {
    throw new Error("The mail server denied label cleanup for a message.");
  }
  if (targets.length === 0) return 0;
  const update = Object.fromEntries(targets.map((message) => [
    message.id,
    { [`keywords/${input.labelId}`]: null },
  ]));
  const setResponse = await client.request([["Email/set", {
    accountId,
    ifInState: source.state,
    update,
  }, "label-cleanup-set"]], [JMAP_MAIL]);
  const result = client.result(
    setResponse, "label-cleanup-set", "Email/set", jmapSetResultSchema,
  );
  if (
    result.accountId !== accountId ||
    Object.keys(result.notUpdated ?? {}).length > 0 ||
    targets.some((message) => !Object.hasOwn(result.updated ?? {}, message.id))
  ) {
    throw new Error("Stalwart did not confirm the label cleanup batch.");
  }
  return targets.length;
};

export const cleanupStalwartLabel = async (
  client: StalwartJmapClient,
  reader: StalwartMailReader,
  input: LabelCleanupInput,
  cursorSecret: string,
  attempt = 0,
): Promise<LabelCleanupResult> => {
  assertLabelCleanupInput(input);
  validateCursor(input, cursorSecret);
  const accountId = await reader.getAccountId();
  try {
    const messageIds = await queryIds(
      client, accountId, input.labelId, input.limit, "label-cleanup-query",
    );
    if (messageIds.length === 0) {
      return { complete: true, cursor: null, processed: 0, removed: 0 };
    }
    const removed = await cleanupBatch(
      client, reader, accountId, input, messageIds,
    );
    const remaining = await queryIds(
      client, accountId, input.labelId, 1, "label-cleanup-verify",
    );
    return {
      complete: remaining.length === 0,
      cursor: remaining.length === 0
        ? null
        : encodeLabelCleanupCursor(cursorPayload(input.labelId), cursorSecret),
      processed: messageIds.length,
      removed,
    };
  } catch (error) {
    if (
      attempt === 0 && error instanceof StalwartJmapMethodError &&
      error.type === "stateMismatch"
    ) {
      return cleanupStalwartLabel(client, reader, input, cursorSecret, 1);
    }
    throw error;
  }
};
