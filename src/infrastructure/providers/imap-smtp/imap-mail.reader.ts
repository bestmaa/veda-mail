import "server-only";

import type {
  AttachmentDownload,
  AttachmentDownloadInput,
  MailAccount,
  Mailbox,
  MessageDetail,
  MessageAttachmentListInput,
  MessageListQuery,
  MessagePage,
} from "@/domain/mail/mail";
import type { MailboxId, MessageId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";
import {
  decodeMailboxId,
  decodeScopedImapMessageId,
  imapUidValidityMatches,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import { downloadImapAttachment } from "@/infrastructure/providers/imap-smtp/imap-attachment-download";
import { listImapMessageAttachments } from "@/infrastructure/providers/imap-smtp/imap-attachment-list";
import { withImapClient } from "@/infrastructure/providers/imap-smtp/imap-client";
import {
  mapImapMailbox,
  mapImapSummary,
  mapParsedMessage,
} from "@/infrastructure/providers/imap-smtp/imap-mail.mapper";
import { parseImapMessagePresentation } from "@/infrastructure/providers/imap-smtp/imap-message-presentation";
import {
  bindImapReceivedAttachments,
  imapAttachmentAccountScope,
} from "@/infrastructure/providers/imap-smtp/imap-received-attachment";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { imapLabelCapability } from "@/infrastructure/providers/imap-smtp/imap-label-mutation";

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

  public getLabelCapability(mailboxId: MailboxId) {
    return withImapClient(this.config, async (client) => {
      const opened = await client.mailboxOpen(decodeMailboxId(mailboxId), {
        readOnly: true,
      });
      return imapLabelCapability(opened.permanentFlags);
    });
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
        items: items.map((message) =>
          mapImapSummary(mailbox, message, {
            config: this.config,
            uidValidity: opened.uidValidity,
          }),
        ),
        nextCursor: nextOffset < uids.length ? String(nextOffset) : null,
        total: query.search ? uids.length : opened.exists,
      };
    });
  }

  public getMessage(messageId: MessageId): Promise<MessageDetail> {
    let reference: ReturnType<typeof decodeScopedImapMessageId>;
    try {
      reference = decodeScopedImapMessageId(this.config, messageId);
    } catch {
      return Promise.reject(new Error("Message not found."));
    }
    return withImapClient(this.config, async (client) => {
      const opened = await client.mailboxOpen(reference.mailbox, {
        readOnly: true,
      });
      if (!imapUidValidityMatches(reference, opened.uidValidity)) {
        throw new Error("Message not found.");
      }
      const message = await client.fetchOne(
        reference.uid,
        { ...summaryQuery, source: { maxLength: 5_000_000 } },
        { uid: true },
      );
      if (!message || message.uid !== reference.uid || !message.source) {
        throw new Error("Message not found.");
      }
      const parsed = await parseImapMessagePresentation(message.source);
      const attachments = message.bodyStructure
        ? bindImapReceivedAttachments({
            accountScope: imapAttachmentAccountScope(this.config),
            messageId,
            structure: message.bodyStructure,
            uidValidity: opened.uidValidity,
          })
        : [];
      return mapParsedMessage(
        mapImapSummary(reference.mailbox, message, {
          config: this.config,
          uidValidity: opened.uidValidity,
        }),
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

  public async listMessageAttachments(input: MessageAttachmentListInput) {
    return listImapMessageAttachments(this.config, input);
  }
}
