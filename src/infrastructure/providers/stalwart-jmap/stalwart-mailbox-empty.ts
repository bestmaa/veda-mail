import "server-only";

import { z } from "zod";

import {
  assertMailboxEmptyInput,
  MailboxEmptyCursorError,
  type MailboxEmptyInput,
  type MailboxEmptyResult,
} from "@/domain/mail/mailbox-empty";
import {
  decodeMailboxEmptyCursor,
  encodeMailboxEmptyCursor,
} from "@/infrastructure/providers/mailbox-empty-cursor";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { jmapIdBooleanRecordSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-record.schema";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import {
  assertMailboxEmptySnapshotUnchanged,
  queryMailboxEmptySnapshot,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-mailbox-empty-query";

const cursorSchema = z.object({
  accountId: z.string().min(1).max(255),
  cutoff: z.iso.datetime({ offset: true }),
  mailboxId: z.string().min(1).max(2_048),
  provider: z.literal("stalwart-jmap"),
  queryState: z.string().min(1).max(1_024),
  version: z.literal(1),
}).strict();
const mailboxResultSchema = z.object({
  accountId: z.string().min(1).max(255),
  list: z.array(z.object({
    id: z.string().min(1).max(2_048),
    myRights: z.object({
      mayReadItems: z.boolean(),
      mayRemoveItems: z.boolean(),
    }).passthrough(),
  }).passthrough()).max(1_024),
  state: z.string().min(1).max(1_024),
}).passthrough();
const sourceSchema = z.object({
  accountId: z.string().min(1).max(255),
  list: z.array(z.object({
    id: z.string().min(1).max(255),
    mailboxIds: jmapIdBooleanRecordSchema,
  }).passthrough()).max(100),
  notFound: z.array(z.string().min(1).max(255)).max(100),
  state: z.string().min(1).max(1_024),
}).passthrough();

interface MailboxRights {
  readonly mayReadItems: boolean;
  readonly mayRemoveItems: boolean;
}

const cursorPayload = (
  accountId: string,
  mailboxId: string,
  cutoff: string,
  queryState: string,
) => ({
  accountId, cutoff, mailboxId, provider: "stalwart-jmap", queryState, version: 1,
} as const);

const operationCutoff = (
  input: MailboxEmptyInput,
  accountId: string,
  secret: string,
): z.infer<typeof cursorSchema> | null => {
  if (!input.cursor) return null;
  try {
    const cursor = cursorSchema.parse(decodeMailboxEmptyCursor(input.cursor, secret));
    if (cursor.accountId !== accountId || cursor.mailboxId !== input.mailboxId) {
      throw new Error("mismatch");
    }
    return cursor;
  } catch {
    throw new MailboxEmptyCursorError();
  }
};

const readRights = async (
  client: StalwartJmapClient,
  accountId: string,
  mailboxId: string,
): Promise<ReadonlyMap<string, MailboxRights>> => {
  const response = await client.request([["Mailbox/get", {
    accountId,
    ids: null,
    properties: ["id", "myRights"],
  }, "mailbox-empty-rights"]], [JMAP_MAIL]);
  const result = client.result(
    response, "mailbox-empty-rights", "Mailbox/get", mailboxResultSchema,
  );
  const rights = new Map(result.list.map((mailbox) => [mailbox.id, mailbox.myRights]));
  const target = rights.get(mailboxId);
  if (
    result.accountId !== accountId ||
    !target?.mayReadItems ||
    !target.mayRemoveItems
  ) {
    throw new Error("The mail server denied emptying this mailbox.");
  }
  return rights;
};

const destroyBatch = async (
  client: StalwartJmapClient,
  accountId: string,
  mailboxId: string,
  messageIds: readonly string[],
  rights: ReadonlyMap<string, MailboxRights>,
): Promise<number> => {
  const sourceResponse = await client.request([["Email/get", {
    accountId,
    ids: messageIds,
    properties: ["id", "mailboxIds"],
  }, "mailbox-empty-source"]], [JMAP_MAIL]);
  const source = client.result(
    sourceResponse, "mailbox-empty-source", "Email/get", sourceSchema,
  );
  const returned = new Set(source.list.map((message) => message.id));
  const unauthorized = source.list.some((message) => {
    const memberships = Object.entries(message.mailboxIds)
      .filter(([, present]) => present)
      .map(([id]) => id);
    return message.mailboxIds[mailboxId] !== true || memberships.some(
      (id) => rights.get(id)?.mayRemoveItems !== true,
    );
  });
  if (
    source.accountId !== accountId ||
    source.notFound.length > 0 ||
    returned.size !== source.list.length ||
    messageIds.some((messageId) => !returned.has(messageId)) ||
    source.list.some((message) => !messageIds.includes(message.id))
  ) {
    throw new StalwartJmapMethodError({ type: "stateMismatch" });
  }
  if (unauthorized) throw new Error("The mail server denied emptying this mailbox.");
  const setResponse = await client.request([["Email/set", {
    accountId,
    destroy: messageIds,
    ifInState: source.state,
  }, "mailbox-empty-set"]], [JMAP_MAIL]);
  const result = client.result(
    setResponse, "mailbox-empty-set", "Email/set", jmapSetResultSchema,
  );
  const destroyed = result.destroyed ?? [];
  if (
    result.accountId !== accountId ||
    Object.keys(result.notDestroyed ?? {}).length > 0 ||
    destroyed.length !== messageIds.length ||
    new Set(destroyed).size !== destroyed.length ||
    messageIds.some((messageId) => !destroyed.includes(messageId))
  ) {
    throw new Error("Stalwart did not confirm the mailbox empty batch.");
  }
  return destroyed.length;
};

export const emptyStalwartMailbox = async (
  client: StalwartJmapClient,
  reader: StalwartMailReader,
  input: MailboxEmptyInput,
  cursorSecret: string,
  now = new Date(),
  attempt = 0,
): Promise<MailboxEmptyResult> => {
  assertMailboxEmptyInput(input);
  const accountId = await reader.getAccountId();
  const cursor = operationCutoff(input, accountId, cursorSecret);
  const cutoff = cursor?.cutoff ?? now.toISOString();
  try {
    const rights = await readRights(client, accountId, input.mailboxId);
    const snapshot = await queryMailboxEmptySnapshot(
      client, accountId, input, cutoff, "mailbox-empty-query",
    );
    if (!cursor && snapshot.ids.length === 0) {
      return { complete: true, cursor: null, processed: 0, removed: 0 };
    }
    if (!input.cursor) {
      return {
        complete: false,
        cursor: encodeMailboxEmptyCursor(
          cursorPayload(
            accountId, input.mailboxId, cutoff, snapshot.queryState,
          ), cursorSecret,
        ),
        processed: 0,
        removed: 0,
      };
    }
    await assertMailboxEmptySnapshotUnchanged(
      client, accountId, input, cutoff, cursor!.queryState,
      "mailbox-empty-before",
    );
    if (snapshot.ids.length === 0) {
      return { complete: true, cursor: null, processed: 0, removed: 0 };
    }
    const removed = await destroyBatch(
      client, accountId, input.mailboxId, snapshot.ids, rights,
    );
    const remaining = await queryMailboxEmptySnapshot(
      client, accountId, input, cutoff, "mailbox-empty-verify",
    );
    await assertMailboxEmptySnapshotUnchanged(
      client, accountId, input, cutoff, snapshot.queryState,
      "mailbox-empty-after",
    );
    return {
      complete: remaining.ids.length === 0,
      cursor: remaining.ids.length === 0 ? null : encodeMailboxEmptyCursor(
        cursorPayload(
          accountId, input.mailboxId, cutoff, remaining.queryState,
        ), cursorSecret,
      ),
      processed: snapshot.ids.length,
      removed,
    };
  } catch (error) {
    if (
      attempt === 0 &&
      error instanceof StalwartJmapMethodError &&
      error.type === "stateMismatch"
    ) {
      return emptyStalwartMailbox(client, reader, input, cursorSecret, now, 1);
    }
    throw error;
  }
};
