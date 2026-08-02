import "server-only";
import type {
  AttachmentDownload,
  AttachmentDownloadInput,
  MailAccount,
  Mailbox,
  MessageDetail,
  MessageListQuery,
  MessageAttachmentListInput,
  MessagePage,
  ReplyContext,
} from "@/domain/mail/mail";
import { id, type MessageId } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  downloadStalwartMessageAttachment,
  listStalwartMessageAttachments,
  normalizeStalwartAttachmentLookupError,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-attachment.reader";
import {
  mapMessageDetail,
  mapMessageSummary,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.mapper";
import {
  jmapEmailSchema,
  jmapListResultSchema,
  jmapQueryResultSchema,
  jmapReplyContextSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import {
  readStalwartMailboxSnapshot,
  type StalwartMailboxSnapshot,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-mailbox.reader";
import { assertStalwartMessageListResult } from "@/infrastructure/providers/stalwart-jmap/stalwart-message-list-result";
import { stalwartSearchFilter } from "@/infrastructure/providers/stalwart-jmap/stalwart-search-filter";
import { JMAP_MAIL, JMAP_RECEIVED_ATTACHMENT_BODY_PROPERTIES,
  MAX_JMAP_BODY_VALUE_BYTES, type StalwartConfig } from
  "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
const summaryPropertiesWithoutPreview = [
  "id",
  "threadId",
  "mailboxIds",
  "keywords",
  "receivedAt",
  "size",
  "subject",
  "from",
  "to",
  "hasAttachment",
] as const;
const summaryProperties = [...summaryPropertiesWithoutPreview, "preview"] as const;
const detailProperties = [
  ...summaryProperties,
  "cc",
  "bcc",
  "replyTo",
  "textBody",
  "htmlBody",
  "attachments",
  "bodyValues",
] as const;

export class StalwartMailReader {
  public constructor(
    private readonly client: StalwartJmapClient,
    private readonly config: StalwartConfig,
  ) {}

  public async getAccount(): Promise<MailAccount> {
    const { accountId, session } = await this.getAccountContext();
    return {
      email: session.username || this.config.username,
      id: id.account(accountId),
      name: session.accounts[accountId]?.name ?? "Mail account",
      providerId: id.provider("stalwart-jmap"),
    };
  }

  public async listMailboxes(): Promise<readonly Mailbox[]> {
    return (await this.getMailboxSnapshot()).mailboxes;
  }

  public async getMailboxSnapshot(): Promise<StalwartMailboxSnapshot> {
    return readStalwartMailboxSnapshot(this.client, await this.getAccountId());
  }

  public async listMessages(query: MessageListQuery): Promise<MessagePage> {
    const { accountId } = await this.getAccountContext();
    const position = Number(query.cursor ?? "0");
    const filter = stalwartSearchFilter(query.mailboxId, query.search);
    const response = await this.client.request(
      [
        [
          "Email/query",
          {
            accountId,
            calculateTotal: true,
            filter,
            limit: query.limit,
            position,
            sort: [{
              isAscending: query.sort === "oldest",
              property: "receivedAt",
            }],
          },
          "query",
        ],
        [
          "Email/get",
          {
            "#ids": {
              name: "Email/query",
              path: "/ids",
              resultOf: "query",
            },
            accountId,
            properties: query.includePreview
              ? summaryProperties
              : summaryPropertiesWithoutPreview,
          },
          "emails",
        ],
      ],
      [JMAP_MAIL],
    );
    const queryResult = this.client.result(
      response,
      "query",
      "Email/query",
      jmapQueryResultSchema,
    );
    const emailResult = this.client.result(
      response,
      "emails",
      "Email/get",
      jmapListResultSchema(jmapEmailSchema),
    );
    assertStalwartMessageListResult(accountId, position, query.limit,
      queryResult, emailResult);
    const nextPosition = position + queryResult.ids.length;
    return {
      items: emailResult.list.map(mapMessageSummary),
      nextCursor:
        nextPosition < queryResult.total ? String(nextPosition) : null,
      total: queryResult.total,
    };
  }

  public async getMessage(messageId: MessageId): Promise<MessageDetail> {
    const { accountId } = await this.getAccountContext();
    const response = await this.client.request(
      [
        [
          "Email/get",
          {
            accountId,
            bodyProperties: JMAP_RECEIVED_ATTACHMENT_BODY_PROPERTIES,
            fetchHTMLBodyValues: true,
            fetchTextBodyValues: true,
            ids: [messageId],
            maxBodyValueBytes: MAX_JMAP_BODY_VALUE_BYTES,
            properties: detailProperties,
          },
          "email",
        ],
      ],
      [JMAP_MAIL],
    );
    const result = this.client.result(
      response,
      "email",
      "Email/get",
      jmapListResultSchema(jmapEmailSchema),
    );
    const email = result.list[0];
    if (result.accountId !== accountId || email?.id !== messageId)
      throw new Error("Message not found.");
    return mapMessageDetail(email, accountId);
  }

  public async downloadAttachment(
    input: AttachmentDownloadInput,
  ): Promise<AttachmentDownload> {
    try {
      const { accountId } = await this.getAccountContext(input.signal);
      return await downloadStalwartMessageAttachment(
        this.client, accountId, input,
      );
    } catch (error) {
      throw normalizeStalwartAttachmentLookupError(error, input.signal);
    }
  }

  public async listMessageAttachments(input: MessageAttachmentListInput) {
    try {
      const { accountId } = await this.getAccountContext(input.signal);
      return await listStalwartMessageAttachments(
        this.client, accountId, input,
      );
    } catch (error) {
      throw normalizeStalwartAttachmentLookupError(error, input.signal);
    }
  }

  public async getAccountId(): Promise<string> {
    return (await this.getAccountContext()).accountId;
  }

  public async getReplyContext(messageId: MessageId): Promise<ReplyContext> {
    const { accountId } = await this.getAccountContext();
    const response = await this.client.request(
      [
        [
          "Email/get",
          {
            accountId,
            ids: [messageId],
            properties: ["id", "messageId", "references"],
          },
          "reply-context",
        ],
      ],
      [JMAP_MAIL],
    );
    const result = this.client.result(
      response,
      "reply-context",
      "Email/get",
      jmapListResultSchema(jmapReplyContextSchema),
    );
    const email = result.list[0];
    if (result.accountId !== accountId || email?.id !== messageId)
      throw new Error("The message being replied to was not found.");
    return {
      messageId: email.messageId?.[0] ?? null,
      references: email.references ?? [],
    };
  }

  private async getAccountContext(signal?: AbortSignal) {
    const session = await this.client.getSession(signal);
    const accountId = session.primaryAccounts[JMAP_MAIL];
    if (!accountId) {
      throw new Error("This Stalwart account does not expose JMAP Mail.");
    }
    return { accountId, session };
  }
}
