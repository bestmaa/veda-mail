import type { MailAddress } from "@/domain/mail/mail";
import type { MessageId } from "@/domain/shared/brand";

export const MAX_PRINT_CONVERSATION_MESSAGES = 100;
export const MAX_PRINT_CONVERSATION_PAGES = 8;
export const MESSAGE_PRINT_CONCURRENCY = 4;

export type MessagePrintScope = "conversation" | "message";

export interface PrintableMessageAttachment {
  readonly mimeType: string;
  readonly name: string;
  readonly size: number | null;
}

export interface PrintableMessage {
  readonly attachments: readonly PrintableMessageAttachment[];
  readonly cc: readonly MailAddress[];
  readonly from: readonly MailAddress[];
  readonly htmlBody: string | null;
  readonly id: MessageId;
  readonly receivedAt: string;
  readonly replyTo: readonly MailAddress[];
  readonly size: number;
  readonly subject: string;
  readonly textBody: string;
  readonly to: readonly MailAddress[];
}

export interface MessagePrintDocument {
  readonly anchorMessageId: MessageId;
  readonly messages: readonly PrintableMessage[];
  readonly scope: MessagePrintScope;
  readonly total: number;
  readonly truncated: boolean;
}
