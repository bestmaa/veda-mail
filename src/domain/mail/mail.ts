import type {
  AccountId,
  AttachmentId,
  AttachmentUploadId,
  DraftId,
  MailboxId,
  MessageId,
  ProviderId,
  ThreadId,
} from "@/domain/shared/brand";

export const MAX_OUTGOING_CONTENT_CHARACTERS = 256_000;
export const MAX_OUTGOING_CONTENT_UTF8_BYTES = 256_000;
export const MAX_OUTGOING_CONTENT_COMBINED_CHARACTERS = 512_000;
export const MAX_OUTGOING_CONTENT_COMBINED_UTF8_BYTES = 512_000;
export const MAX_OUTGOING_HTML_NODES = 1_000;

export type MailboxRole =
  "archive" | "drafts" | "inbox" | "sent" | "spam" | "trash" | "custom";

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

export type ReceivedAttachmentDisposition = "attachment" | "inline";

export interface Attachment {
  readonly disposition: ReceivedAttachmentDisposition;
  readonly id: AttachmentId;
  readonly mimeType: string;
  readonly name: string;
  readonly size: number | null;
}

export type MessageAttachmentMetadata = Attachment;

export interface AttachmentDownloadInput {
  readonly attachmentId: AttachmentId;
  readonly maxBytes: number;
  readonly messageId: MessageId;
  readonly signal?: AbortSignal;
}

export interface AttachmentDownload {
  readonly body: ReadableStream<Uint8Array>;
  readonly mimeType: string;
  readonly name: string;
  readonly size: number | null;
}

export interface MessageAttachmentListInput {
  readonly messageId: MessageId;
  readonly signal?: AbortSignal;
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
  readonly attachmentIds?: readonly AttachmentUploadId[];
  readonly bcc: readonly MailAddress[];
  readonly body: string;
  readonly cc: readonly MailAddress[];
  readonly draftId?: DraftId;
  readonly htmlBody?: string;
  readonly inReplyTo?: MessageId;
  readonly subject: string;
  readonly to: readonly MailAddress[];
}

export interface OutgoingAttachment {
  readonly content: Uint8Array;
  readonly id: AttachmentUploadId;
  readonly mimeType: string;
  readonly name: string;
  readonly sha256: string;
  readonly size: number;
}

export interface SendMessageInput {
  readonly attachments?: readonly OutgoingAttachment[];
  readonly bcc: readonly MailAddress[];
  readonly body: string;
  readonly cc: readonly MailAddress[];
  readonly htmlBody?: string;
  readonly inReplyTo?: MessageId;
  readonly subject: string;
  readonly to: readonly MailAddress[];
}

export interface UploadedAttachment {
  readonly expiresAt: string;
  readonly id: AttachmentUploadId;
  readonly mimeType: string;
  readonly name: string;
  readonly size: number;
}

export interface SendReceipt {
  readonly deliveryNoticeId?: string;
  readonly deliveryStatus: "accepted" | "partial" | "uncertain";
  readonly id: MessageId;
  readonly rejectedRecipients: readonly string[];
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

export interface ProviderMailWorkspace {
  readonly account: MailAccount;
  readonly mailboxes: readonly Mailbox[];
  readonly messages: MessagePage;
}

export interface MailWorkspace extends ProviderMailWorkspace {
  readonly sessionScope: string;
}
