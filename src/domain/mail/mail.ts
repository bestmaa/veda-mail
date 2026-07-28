import type {
  AccountId,
  MailboxId,
  MessageId,
  ProviderId,
  ThreadId,
} from "@/domain/shared/brand";

export type MailboxRole =
  | "archive"
  | "drafts"
  | "inbox"
  | "sent"
  | "spam"
  | "trash"
  | "custom";

export interface MailAddress {
  readonly email: string;
  readonly name: string | null;
}

export interface Mailbox {
  readonly color: string;
  readonly id: MailboxId;
  readonly name: string;
  readonly role: MailboxRole;
  readonly total: number;
  readonly unread: number;
}

export interface Attachment {
  readonly id: string;
  readonly mimeType: string;
  readonly name: string;
  readonly size: number;
}

export interface MessageSummary {
  readonly from: readonly MailAddress[];
  readonly hasAttachment: boolean;
  readonly id: MessageId;
  readonly isStarred: boolean;
  readonly isUnread: boolean;
  readonly mailboxIds: readonly MailboxId[];
  readonly preview: string;
  readonly receivedAt: string;
  readonly size: number;
  readonly subject: string;
  readonly threadId: ThreadId;
  readonly to: readonly MailAddress[];
}

export interface MessageDetail extends MessageSummary {
  readonly attachments: readonly Attachment[];
  readonly cc: readonly MailAddress[];
  readonly htmlBody: string | null;
  readonly replyTo: readonly MailAddress[];
  readonly textBody: string;
}

export interface MessagePage {
  readonly items: readonly MessageSummary[];
  readonly nextCursor: string | null;
  readonly total: number;
}

export interface MessageListQuery {
  readonly cursor?: string;
  readonly limit: number;
  readonly mailboxId: MailboxId;
  readonly search?: string;
}

export type MessageMutation =
  | {
      readonly messageId: MessageId;
      readonly type: "archive" | "delete" | "restore";
    }
  | {
      readonly messageId: MessageId;
      readonly type: "set-read" | "set-starred";
      readonly value: boolean;
    }
  | {
      readonly mailboxId: MailboxId;
      readonly messageId: MessageId;
      readonly type: "move";
    };

export interface ComposeInput {
  readonly bcc: readonly MailAddress[];
  readonly body: string;
  readonly cc: readonly MailAddress[];
  readonly inReplyTo?: MessageId;
  readonly subject: string;
  readonly to: readonly MailAddress[];
}

export interface SendReceipt {
  readonly id: MessageId;
  readonly submittedAt: string;
}

export interface ReplyContext {
  readonly messageId: string | null;
  readonly references: readonly string[];
}

export interface MailAccount {
  readonly email: string;
  readonly id: AccountId;
  readonly name: string;
  readonly providerId: ProviderId;
}

export interface MailWorkspace {
  readonly account: MailAccount;
  readonly mailboxes: readonly Mailbox[];
  readonly messages: MessagePage;
}
