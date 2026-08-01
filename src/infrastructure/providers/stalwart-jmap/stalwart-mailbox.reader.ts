import "server-only";

import type { Mailbox } from "@/domain/mail/mail";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { mapMailbox } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.mapper";
import { jmapListResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { jmapMailboxSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-mailbox.schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export interface StalwartMailboxSnapshot {
  readonly accountId: string;
  readonly mailboxes: readonly Mailbox[];
  readonly state: string;
}

export const readStalwartMailboxSnapshot = async (
  client: StalwartJmapClient,
  accountId: string,
): Promise<StalwartMailboxSnapshot> => {
  const response = await client.request(
    [["Mailbox/get", { accountId, properties: null }, "mailboxes"]],
    [JMAP_MAIL],
  );
  const result = client.result(
    response,
    "mailboxes",
    "Mailbox/get",
    jmapListResultSchema(jmapMailboxSchema),
  );
  if (result.accountId !== accountId) {
    throw new Error("Mail provider returned a mailbox account mismatch.");
  }
  return {
    accountId,
    mailboxes: result.list.map(mapMailbox),
    state: result.state,
  };
};
