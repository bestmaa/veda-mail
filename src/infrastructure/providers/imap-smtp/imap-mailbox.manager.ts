import "server-only";

import type { ImapFlow, ListResponse } from "imapflow";

import type {
  Mailbox,
  MailboxMutation,
  MailboxMutationResult,
} from "@/domain/mail/mail";
import {
  assertMailboxMutation,
  MailboxPolicyError,
} from "@/domain/mail/mailbox-policy";
import type { MailboxId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";
import {
  decodeMailboxId,
  encodeMailboxId,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import { withImapClient } from "@/infrastructure/providers/imap-smtp/imap-client";
import { mapImapMailbox } from "@/infrastructure/providers/imap-smtp/imap-mail.mapper";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const list = async (
  client: ImapFlow,
): Promise<{ readonly domain: readonly Mailbox[]; readonly raw: readonly ListResponse[] }> => {
  const raw = (await client.list({
    statusQuery: { messages: true, unseen: true },
  })).filter((mailbox) => mailbox.listed);
  return { domain: raw.map(mapImapMailbox), raw };
};

const rawMailbox = (
  raw: readonly ListResponse[],
  mailboxId: MailboxId,
): ListResponse => {
  const path = decodeMailboxId(mailboxId);
  const mailbox = raw.find((candidate) => candidate.path === path);
  if (!mailbox) {
    throw new MailboxPolicyError("missing", "The mailbox no longer exists.");
  }
  return mailbox;
};

const assertLeafName = (name: string, delimiter: string): void => {
  if (delimiter && name.includes(delimiter)) {
    throw new MailboxPolicyError(
      "name",
      `Mailbox names cannot contain the server delimiter “${delimiter}”.`,
    );
  }
};

const pathFor = (
  name: string,
  parent: ListResponse | null,
  delimiter: string,
): string => (parent ? `${parent.path}${delimiter}${name}` : name);

const parentFor = (
  raw: readonly ListResponse[],
  parentId: MailboxId | null,
): ListResponse | null => (parentId ? rawMailbox(raw, parentId) : null);

export class ImapMailboxManager {
  public constructor(private readonly config: ImapSmtpMemberConfig) {}

  public mutate(mutation: MailboxMutation): Promise<MailboxMutationResult> {
    return withImapClient(this.config, async (client) => {
      const before = await list(client);
      assertMailboxMutation(before.domain, mutation);
      if (mutation.type === "create") {
        return this.create(client, before.raw, mutation);
      }
      if (mutation.type === "update") {
        return this.update(client, before.raw, mutation);
      }
      return this.delete(client, before.raw, mutation);
    });
  }

  private async create(
    client: ImapFlow,
    raw: readonly ListResponse[],
    mutation: Extract<MailboxMutation, { readonly type: "create" }>,
  ): Promise<MailboxMutationResult> {
    const parent = parentFor(raw, mutation.parentId);
    const delimiter = parent?.delimiter || raw[0]?.delimiter || "/";
    assertLeafName(mutation.name, delimiter);
    const path = pathFor(mutation.name, parent, delimiter);
    const response = await client.mailboxCreate(path);
    if (!response.created) {
      throw new MailboxPolicyError(
        "conflict",
        "A mailbox with this name already exists here.",
      );
    }
    await client.mailboxSubscribe(response.path).catch(() => false);
    return {
      mailboxId: id.mailbox(encodeMailboxId(response.path)),
      mailboxes: (await list(client)).domain,
    };
  }

  private async update(
    client: ImapFlow,
    raw: readonly ListResponse[],
    mutation: Extract<MailboxMutation, { readonly type: "update" }>,
  ): Promise<MailboxMutationResult> {
    const target = rawMailbox(raw, mutation.mailboxId);
    const currentParent = target.parentPath
      ? raw.find(({ path }) => path === target.parentPath) ?? null
      : null;
    const parent = mutation.parentId === undefined
      ? currentParent
      : parentFor(raw, mutation.parentId);
    const delimiter = parent?.delimiter || target.delimiter || raw[0]?.delimiter || "/";
    const name = mutation.name ?? target.name;
    assertLeafName(name, delimiter);
    const newPath = pathFor(name, parent, delimiter);
    let confirmedPath = newPath;
    if (newPath !== target.path) {
      confirmedPath = (await client.mailboxRename(target.path, newPath)).newPath;
    }
    return {
      mailboxId: id.mailbox(encodeMailboxId(confirmedPath)),
      mailboxes: (await list(client)).domain,
    };
  }

  private async delete(
    client: ImapFlow,
    raw: readonly ListResponse[],
    mutation: Extract<MailboxMutation, { readonly type: "delete" }>,
  ): Promise<MailboxMutationResult> {
    const target = rawMailbox(raw, mutation.mailboxId);
    const status = await client.status(target.path, { messages: true });
    if (status.messages !== 0) {
      throw new MailboxPolicyError(
        "mail-exists",
        status.messages === undefined
          ? "The mail server could not verify that this mailbox is empty."
          : "Empty this mailbox before deleting it.",
      );
    }
    await client.mailboxDelete(target.path);
    return { mailboxId: null, mailboxes: (await list(client)).domain };
  }
}
