import type { MessagePrintDocument } from "@/domain/mail/message-print";
import type { MailLocale } from "@/domain/mail/message-list-preferences";

export interface MessagePrintViewModel {
  readonly canPrintConversation: boolean;
  readonly document: MessagePrintDocument | null;
  readonly error: string | null;
  readonly isPreparing: boolean;
  readonly locale: MailLocale;
  readonly onPrintConversation: () => void;
  readonly onPrintMessage: () => void;
  readonly onPrinted: () => void;
  readonly timeZone: string;
}
