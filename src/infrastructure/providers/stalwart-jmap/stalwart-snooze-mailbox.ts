import "server-only";

import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import {
  stalwartSnoozeMailboxResultSchema,
  type StalwartSnoozeMailbox,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-snooze-schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export interface StalwartSnoozeMailboxSnapshot {
  readonly list: readonly StalwartSnoozeMailbox[];
  readonly state: string;
}

export const readStalwartSnoozeMailboxes = async (
  client: StalwartJmapClient,
  accountId: string,
): Promise<StalwartSnoozeMailboxSnapshot> => {
  const response = await client.request([["Mailbox/get", {
    accountId,
    ids: null,
    properties: ["id", "name", "parentId", "role", "myRights"],
  }, "snooze-mailboxes"]], [JMAP_MAIL]);
  const result = client.result(
    response, "snooze-mailboxes", "Mailbox/get",
    stalwartSnoozeMailboxResultSchema,
  );
  if (result.accountId !== accountId || result.notFound.length) {
    throw new Error("The provider returned invalid snooze mailbox data.");
  }
  return { list: result.list, state: result.state };
};

const usable = (mailbox: StalwartSnoozeMailbox): boolean =>
  mailbox.parentId == null && mailbox.role == null &&
  mailbox.myRights?.mayAddItems === true &&
  mailbox.myRights.mayRemoveItems === true;

export const findStalwartSnoozedMailbox = (
  snapshot: StalwartSnoozeMailboxSnapshot,
  expectedId: string | null,
  expectedName: string,
): StalwartSnoozeMailbox | null => {
  const matches = expectedId
    ? snapshot.list.filter(({ id }) => id === expectedId)
    : snapshot.list.filter(({ name, parentId }) =>
        name === expectedName && parentId == null);
  if (matches.length > 1 || (matches[0] && !usable(matches[0]))) {
    throw new Error("The Snoozed mailbox is unavailable or ambiguous.");
  }
  return matches[0] ?? null;
};

export const ensureStalwartSnoozedMailbox = async (
  client: StalwartJmapClient,
  accountId: string,
  expectedId: string | null,
  expectedName: string,
  attempt = 0,
): Promise<string> => {
  const snapshot = await readStalwartSnoozeMailboxes(client, accountId);
  const existing = findStalwartSnoozedMailbox(snapshot, expectedId, expectedName);
  if (existing) return existing.id;
  if (expectedId) throw new Error("The owned Snoozed mailbox was removed.");
  try {
    const response = await client.request([["Mailbox/set", {
      accountId,
      create: { snoozed: {
        isSubscribed: true,
        name: expectedName,
        parentId: null,
        role: null,
        sortOrder: 1_000,
      } },
      ifInState: snapshot.state,
    }, "create-snoozed"]], [JMAP_MAIL]);
    const result = client.result(
      response, "create-snoozed", "Mailbox/set", jmapSetResultSchema,
    );
    const created = result.created?.["snoozed"]?.id;
    if (result.accountId && result.accountId !== accountId || !created) {
      throw new Error("The provider did not create the Snoozed mailbox.");
    }
    return created;
  } catch (error) {
    if (attempt === 0 && error instanceof StalwartJmapMethodError &&
      error.type === "stateMismatch") {
      return ensureStalwartSnoozedMailbox(client, accountId, null, expectedName, 1);
    }
    if (attempt === 0) {
      const recovered = findStalwartSnoozedMailbox(
        await readStalwartSnoozeMailboxes(client, accountId), null, expectedName,
      );
      if (recovered) return recovered.id;
    }
    throw error;
  }
};
