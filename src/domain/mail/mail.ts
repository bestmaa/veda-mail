import type {
  AccountId,
  AttachmentId,
  AttachmentUploadId,
  DraftId,
  LabelId,
  MailboxId,
  MessageId,
  ProviderId,
  ThreadId,
} from "@/domain/shared/brand";
import type { DraftCapability, SavedProviderDraft } from "@/domain/mail/draft";
import type { Mailbox } from "@/domain/mail/mailbox";
import type {
  LabelCapability,
  MailLabel,
  MailLabelDeletion,
} from "@/domain/mail/label";
import type { MailboxEmptyOperation } from "@/domain/mail/mailbox-empty";
import type { MessageListPreferences, MessageListSort } from "@/domain/mail/message-list-preferences";
import type { MailSearchQuery } from "@/domain/mail/mail-search";
export type {
  Mailbox, MailboxMutation,
  MailboxMutationResult,
  MailboxRights,
  MailboxRole,
} from "@/domain/mail/mailbox";

export const MAX_OUTGOING_CONTENT_CHARACTERS = 256_000;
export const MAX_OUTGOING_CONTENT_UTF8_BYTES = 256_000;
export const MAX_OUTGOING_CONTENT_COMBINED_CHARACTERS = 512_000;
export const MAX_OUTGOING_CONTENT_COMBINED_UTF8_BYTES = 512_000;
export const MAX_OUTGOING_HTML_NODES = 1_000;

export interface MailAddress {
  readonly email: string;
  readonly name: string | null;
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
  readonly labelIds: readonly LabelId[];
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
  readonly includePreview: boolean;
  readonly limit: number;
  readonly mailboxId: MailboxId;
  readonly search?: MailSearchQuery;
  readonly sort: MessageListSort;
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
      readonly labelId: LabelId;
      readonly messageId: MessageId;
      readonly type: "set-label";
      readonly value: boolean;
    }
  | {
      readonly mailboxId: MailboxId;
      readonly messageId: MessageId;
      readonly type: "destroy";
    }
  | {
      readonly destinationMailboxId: MailboxId;
      readonly messageId: MessageId;
      readonly sourceMailboxId: MailboxId;
      readonly type: "move";
    };

export type BulkMessageMutation =
  | {
      readonly messageIds: readonly MessageId[];
      readonly type: "archive" | "delete" | "restore";
    }
  | {
      readonly messageIds: readonly MessageId[];
      readonly type: "set-read" | "set-starred";
      readonly value: boolean;
    }
  | {
      readonly labelId: LabelId;
      readonly messageIds: readonly MessageId[];
      readonly type: "set-label";
      readonly value: boolean;
    }
  | {
      readonly mailboxId: MailboxId;
      readonly messageIds: readonly MessageId[];
      readonly type: "destroy";
    }
  | {
      readonly destinationMailboxId: MailboxId;
      readonly messageIds: readonly MessageId[];
      readonly sourceMailboxId: MailboxId;
      readonly type: "move";
    };

export interface BulkMessageMutationResult {
  readonly failed: readonly MessageId[];
  readonly succeeded: readonly MessageId[];
  readonly unconfirmed?: readonly MessageId[];
}

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
  readonly providerDraft?: SavedProviderDraft;
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
  readonly draftCapability: DraftCapability;
  readonly labelCapability: LabelCapability;
  readonly mailboxes: readonly Mailbox[];
  readonly messages: MessagePage;
}

export interface MailWorkspace extends ProviderMailWorkspace {
  readonly labelDeletions?: readonly MailLabelDeletion[];
  readonly labels: readonly MailLabel[];
  readonly mailboxEmptyOperations?: readonly MailboxEmptyOperation[];
  readonly messageListPreferences: MessageListPreferences;
  readonly selectedMailboxId?: MailboxId;
  readonly sessionExpiresAt: string;
  readonly sessionScope: string;
}
