import type { MessageDetail } from "@/domain/mail/mail";
import type { MailLocale } from "@/domain/mail/message-list-preferences";
import { formatAddressInput } from "@/domain/mail/compose";
import type { LabelCapability, MailLabel } from "@/domain/mail/label";
import type { LabelId } from "@/domain/shared/brand";
import type { ReaderViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { ConversationViewModel } from "@/presentation/features/mail-workspace/conversation.view-model";
import type { MessagePrintViewModel } from "@/presentation/features/mail-workspace/message-print.view-model";
import {
  createAttachmentArchiveViewModel,
  createReceivedAttachmentViewModels,
} from "@/presentation/features/mail-workspace/received-attachment.view-model";
import {
  formatFullDate,
  formatFileSize,
  formatSender,
  initials,
} from "@/presentation/shared/formatters/mail-formatters";

interface ReaderAttachmentPreviewModel {
  readonly close: () => void;
  readonly error: string | null;
  readonly href: string | null;
  readonly isLoading: boolean;
  readonly isOpen: boolean;
  readonly name: string;
  readonly open: (
    href: string,
    name: string,
    trigger: HTMLButtonElement,
  ) => Promise<void>;
  readonly restoreFocus: () => void;
  readonly url: string | null;
}

interface ReaderArchiveDownloadModel {
  readonly download: (href: string) => Promise<void>;
  readonly error: string | null;
  readonly href: string | null;
  readonly isPreparing: boolean;
}

interface ReaderAttachmentDownloadModel {
  readonly download: (href: string, name: string) => Promise<void>;
  readonly error: string | null;
  readonly href: string | null;
  readonly isDownloading: boolean;
}

export const createReaderViewModel = (input: {
  readonly archiveDownload: ReaderArchiveDownloadModel;
  readonly attachmentDownload: ReaderAttachmentDownloadModel;
  readonly attachmentPreview: ReaderAttachmentPreviewModel;
  readonly canArchive: boolean;
  readonly conversation: ConversationViewModel;
  readonly deletingLabelIds: ReadonlySet<LabelId>;
  readonly isLoading: boolean;
  readonly message: MessageDetail | null;
  readonly labelCapability: LabelCapability;
  readonly labels: readonly MailLabel[];
  readonly locale?: MailLocale;
  readonly onSetLabel: (labelId: LabelId, value: boolean) => void;
  readonly print: MessagePrintViewModel;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly readerError: string | null;
  readonly sessionScope: string;
  readonly timeZone?: string;
}): ReaderViewModel | null => {
  if (!input.message && !input.isLoading) return null;
  if (!input.message) {
    return {
      attachments: [],
      attachmentPreview: {
        error: null,
        isLoading: false,
        isOpen: false,
        name: "",
        onClose: input.attachmentPreview.close,
        onRestoreFocus: input.attachmentPreview.restoreFocus,
        url: null,
      },
      avatar: "",
      body: "",
      canArchive: false,
      cc: "",
      conversation: input.conversation,
      date: "",
      details: {
        attachments: "",
        cc: null,
        conversationPosition: null,
        date: "",
        from: "",
        messageSize: "",
        replyTo: null,
        to: "",
      },
      downloadAll: null,
      error: input.readerError,
      from: "",
      fromEmail: "",
      htmlBody: null,
      handleSessionFailure: input.handleSessionFailure,
      isLoading: true,
      isStarred: false,
      isUnread: false,
      labelActions: null,
      labels: [],
      messageId: "",
      print: input.print,
      sessionScope: input.sessionScope,
      subject: "Opening message…",
      to: "",
    };
  }
  const message = input.message;
  const appliedLabelIds = new Set(message.labelIds ?? []);
  const appliedLabels = input.labels.filter(({ id }) => appliedLabelIds.has(id));
  const mutableLabels = input.labels.filter(
    ({ id }) => !input.deletingLabelIds.has(id),
  );
  const visibleAttachments = message.attachments.filter(
    ({ disposition }) => disposition === "attachment",
  );
  const archive = createAttachmentArchiveViewModel(
    message.id,
    visibleAttachments.length,
    input.archiveDownload,
  );
  const previewBelongsToMessage = Boolean(
    input.attachmentPreview.href?.startsWith(
      `/api/v1/mail/messages/${encodeURIComponent(message.id)}/attachments/`,
    ),
  );
  const conversationIndex = input.conversation.items.findIndex(
    ({ id: conversationMessageId }) => conversationMessageId === message.id,
  );
  const knownAttachmentBytes = visibleAttachments.reduce(
    (total, attachment) => total + (attachment.size ?? 0),
    0,
  );
  const allAttachmentSizesKnown = visibleAttachments.every(
    ({ size }) => size !== null,
  );
  const attachmentCount = visibleAttachments.length;
  const attachmentDetails = attachmentCount === 0
    ? "None"
    : `${attachmentCount} ${attachmentCount === 1 ? "file" : "files"}${
      allAttachmentSizesKnown
        ? ` (${formatFileSize(knownAttachmentBytes, input.locale ?? "en-IN")})`
        : ""
    }`;
  const date = formatFullDate(
    message.receivedAt, input.locale ?? "en-IN", input.timeZone,
  );
  return {
    attachments: createReceivedAttachmentViewModels(
      message.id,
      visibleAttachments,
      input.attachmentPreview,
      input.attachmentDownload,
      input.locale ?? "en-IN",
    ),
    attachmentPreview: {
      error: previewBelongsToMessage ? input.attachmentPreview.error : null,
      isLoading:
        previewBelongsToMessage && input.attachmentPreview.isLoading,
      isOpen: previewBelongsToMessage && input.attachmentPreview.isOpen,
      name: previewBelongsToMessage ? input.attachmentPreview.name : "",
      onClose: input.attachmentPreview.close,
      onRestoreFocus: input.attachmentPreview.restoreFocus,
      url: previewBelongsToMessage ? input.attachmentPreview.url : null,
    },
    avatar: initials(formatSender(message.from)),
    body: message.textBody,
    canArchive: input.canArchive,
    cc: message.cc.map((address) => address.email).join(", "),
    conversation: input.conversation,
    date,
    details: {
      attachments: attachmentDetails,
      cc: formatAddressInput(message.cc) || null,
      conversationPosition:
        input.conversation.total > 1 && conversationIndex >= 0
          ? `Message ${conversationIndex + 1} of ${input.conversation.total}`
          : null,
      date,
      from: formatAddressInput(message.from) || "Unknown sender",
      messageSize: formatFileSize(message.size, input.locale ?? "en-IN"),
      replyTo: formatAddressInput(message.replyTo) || null,
      to: formatAddressInput(message.to) || "Undisclosed recipients",
    },
    downloadAll: archive.downloadAll,
    error: input.readerError,
    from: formatSender(message.from),
    fromEmail: message.from[0]?.email ?? "",
    htmlBody: message.htmlBody,
    handleSessionFailure: input.handleSessionFailure,
    isLoading: input.isLoading,
    isStarred: message.isStarred,
    isUnread: message.isUnread,
    labelActions: input.labelCapability === "supported" ? {
      applyOptions: mutableLabels.filter(({ id }) => !appliedLabelIds.has(id)),
      onApply: (labelId) => input.onSetLabel(labelId as LabelId, true),
      onRemove: (labelId) => input.onSetLabel(labelId as LabelId, false),
      removeOptions: appliedLabels.filter(
        ({ id }) => !input.deletingLabelIds.has(id),
      ),
    } : null,
    labels: appliedLabels,
    messageId: message.id,
    print: input.print,
    sessionScope: input.sessionScope,
    subject: message.subject,
    to: message.to.map((address) => address.email).join(", "),
  };
};
