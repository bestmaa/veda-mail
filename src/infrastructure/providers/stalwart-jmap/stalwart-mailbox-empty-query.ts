import "server-only";

import { z } from "zod";

import { MailboxEmptyCursorError, type MailboxEmptyInput } from "@/domain/mail/mailbox-empty";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const querySchema = z.object({
  accountId: z.string().min(1).max(255),
  ids: z.array(z.string().min(1).max(255)).max(100),
  position: z.literal(0),
  queryState: z.string().min(1).max(1_024),
}).passthrough();
const changesSchema = z.object({
  accountId: z.string().min(1).max(255),
  added: z.array(z.object({
    id: z.string().min(1).max(255),
    index: z.number().int().nonnegative(),
  }).passthrough()).max(101),
  hasMoreChanges: z.boolean(),
  newQueryState: z.string().min(1).max(1_024),
  oldQueryState: z.string().min(1).max(1_024),
  removed: z.array(z.string().min(1).max(255)).max(101),
}).passthrough();

export interface MailboxEmptyQuerySnapshot {
  readonly ids: readonly string[];
  readonly queryState: string;
}

const filter = (mailboxId: string, cutoff: string) => ({
  before: cutoff,
  inMailbox: mailboxId,
});

export const queryMailboxEmptySnapshot = async (
  client: StalwartJmapClient,
  accountId: string,
  input: MailboxEmptyInput,
  cutoff: string,
  callId: string,
): Promise<MailboxEmptyQuerySnapshot> => {
  const response = await client.request([["Email/query", {
    accountId,
    filter: filter(input.mailboxId, cutoff),
    limit: input.limit,
    position: 0,
  }, callId]], [JMAP_MAIL]);
  const result = client.result(response, callId, "Email/query", querySchema);
  if (
    result.accountId !== accountId ||
    result.ids.length > input.limit ||
    new Set(result.ids).size !== result.ids.length
  ) {
    throw new Error("Stalwart returned an invalid mailbox empty query.");
  }
  return { ids: result.ids, queryState: result.queryState };
};

export const assertMailboxEmptySnapshotUnchanged = async (
  client: StalwartJmapClient,
  accountId: string,
  input: MailboxEmptyInput,
  cutoff: string,
  sinceQueryState: string,
  callId: string,
): Promise<void> => {
  try {
    const response = await client.request([["Email/queryChanges", {
      accountId,
      filter: filter(input.mailboxId, cutoff),
      maxChanges: input.limit + 1,
      sinceQueryState,
    }, callId]], [JMAP_MAIL]);
    const result = client.result(
      response, callId, "Email/queryChanges", changesSchema,
    );
    if (
      result.accountId !== accountId ||
      result.oldQueryState !== sinceQueryState ||
      result.hasMoreChanges ||
      result.added.length > 0
    ) {
      throw new MailboxEmptyCursorError();
    }
  } catch (error) {
    if (error instanceof MailboxEmptyCursorError) throw error;
    if (error instanceof StalwartJmapMethodError) {
      throw new MailboxEmptyCursorError();
    }
    throw error;
  }
};
