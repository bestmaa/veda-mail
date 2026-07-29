import "server-only";

import { simpleParser } from "mailparser";

import type {
  AttachmentDownload,
  AttachmentDownloadInput,
  MailAccount,
  Mailbox,
  MessageDetail,
  MessageListQuery,
  MessagePage,
} from "@/domain/mail/mail";
import type { MessageId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";
import {
  decodeMailboxId,
  decodeMessageId,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import { downloadImapAttachment } from "@/infrastructure/providers/imap-smtp/imap-attachment-download";
import { withImapClient } from "@/infrastructure/providers/imap-smtp/imap-client";
import {
  mapImapMailbox,
  mapImapSummary,
  mapParsedMessage,
} from "@/infrastructure/providers/imap-smtp/imap-mail.mapper";
import {
  bindImapReceivedAttachments,
  imapAttachmentAccountScope,
} from "@/infrastructure/providers/imap-smtp/imap-received-attachment";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const summaryQuery = {
  bodyStructure: true,
  envelope: true,
  flags: true,
  internalDate: true,
  size: true,
  threadId: true,
  uid: true,
} as const;

export class ImapMailReader {
  public constructor(private readonly config: ImapSmtpMemberConfig) {}

  public async getAccount(): Promise<MailAccount> {
    return {
      email: this.config.username,
      id: id.account(this.config.username.toLowerCase()),
      name: this.config.username.split("@")[0] ?? "Mail account",
      providerId: id.provider("imap-smtp"),
    };
  }

  public listMailboxes(): Promise<readonly Mailbox[]> {
    return withImapClient(this.config, async (client) => {
      const mailboxes = await client.list({
        statusQuery: { messages: true, unseen: true },
      });
      return mailboxes.filter((mailbox) => mailbox.listed).map(mapImapMailbox);
    });
  }

  public listMessages(query: MessageListQuery): Promise<MessagePage> {
    return withImapClient(this.config, async (client) => {
      const mailbox = decodeMailboxId(query.mailboxId);
      const opened = await client.mailboxOpen(mailbox);
      const offset = Number(query.cursor ?? "0");
      const matching = query.search
        ? await client.search({ text: query.search }, { uid: true })
        : await client.search({ all: true }, { uid: true });
      const uids = matching === false ? [] : matching;
      const pageUids = uids
        .slice()
        .sort((left, right) => right - left)
        .slice(offset, offset + query.limit);
      const items = pageUids.length
        ? await client.fetchAll(pageUids, summaryQuery, { uid: true })
        : [];
      const order = new Map(pageUids.map((uid, index) => [uid, index]));
      items.sort(
        (left, right) =>
          (order.get(left.uid) ?? 0) - (order.get(right.uid) ?? 0),
      );
      const nextOffset = offset + items.length;
      return {
        items: items.map((message) => mapImapSummary(mailbox, message)),
        nextCursor: nextOffset < uids.length ? String(nextOffset) : null,
        total: query.search ? uids.length : opened.exists,
      };
    });
  }

  public getMessage(messageId: MessageId): Promise<MessageDetail> {
    return withImapClient(this.config, async (client) => {
      const reference = decodeMessageId(messageId);
      const opened = await client.mailboxOpen(reference.mailbox, {
        readOnly: true,
      });
      const message = await client.fetchOne(
        reference.uid,
        { ...summaryQuery, source: { maxLength: 5_000_000 } },
        { uid: true },
      );
      if (
        !message ||
        message.uid !== reference.uid ||
        !message.source
      ) {
        throw new Error("Message not found.");
      }
      const parsed = await simpleParser(message.source, {
        skipHtmlToText: true,
        skipTextToHtml: true,
      });
      const attachments = message.bodyStructure
        ? bindImapReceivedAttachments({
            accountScope: imapAttachmentAccountScope(this.config.username),
            messageId,
            structure: message.bodyStructure,
            uidValidity: opened.uidValidity,
          }).map((attachment) => attachment.metadata)
        : [];
      return mapParsedMessage(
        mapImapSummary(reference.mailbox, message),
        parsed,
        attachments,
      );
    });
  }

  public downloadAttachment(
    input: AttachmentDownloadInput,
  ): Promise<AttachmentDownload> {
    return downloadImapAttachment(this.config, input);
  }
}
