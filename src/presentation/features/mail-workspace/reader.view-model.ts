import type { MessageDetail } from "@/domain/mail/mail";
import type { LabelCapability, MailLabel } from "@/domain/mail/label";
import type { LabelId } from "@/domain/shared/brand";
import type { ReaderViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import {
  createAttachmentArchiveViewModel,
  createReceivedAttachmentViewModels,
} from "@/presentation/features/mail-workspace/received-attachment.view-model";
import {
  formatFullDate,
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
  readonly isLoading: boolean;
  readonly message: MessageDetail | null;
  readonly labelCapability: LabelCapability;
  readonly labels: readonly MailLabel[];
  readonly onSetLabel: (labelId: LabelId, value: boolean) => void;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly readerError: string | null;
  readonly sessionScope: string;
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
      date: "",
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
      sessionScope: input.sessionScope,
      subject: "Opening message…",
      to: "",
    };
  }
  const message = input.message;
  const appliedLabelIds = new Set(message.labelIds ?? []);
  const appliedLabels = input.labels.filter(({ id }) => appliedLabelIds.has(id));
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
  const downloadBelongsToMessage = Boolean(
    input.attachmentDownload.href?.startsWith(
      `/api/v1/mail/messages/${encodeURIComponent(message.id)}/attachments/`,
    ),
  );
  return {
    attachments: createReceivedAttachmentViewModels(
      message.id,
      visibleAttachments,
      input.attachmentPreview,
      input.attachmentDownload,
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
    date: formatFullDate(message.receivedAt),
    downloadAll: archive.downloadAll,
    error:
      archive.error ??
      (downloadBelongsToMessage ? input.attachmentDownload.error : null) ??
      input.readerError,
    from: formatSender(message.from),
    fromEmail: message.from[0]?.email ?? "",
    htmlBody: message.htmlBody,
    handleSessionFailure: input.handleSessionFailure,
    isLoading: input.isLoading,
    isStarred: message.isStarred,
    isUnread: message.isUnread,
    labelActions: input.labelCapability === "supported" ? {
      applyOptions: input.labels.filter(({ id }) => !appliedLabelIds.has(id)),
      onApply: (labelId) => input.onSetLabel(labelId as LabelId, true),
      onRemove: (labelId) => input.onSetLabel(labelId as LabelId, false),
      removeOptions: appliedLabels,
    } : null,
    labels: appliedLabels,
    messageId: message.id,
    sessionScope: input.sessionScope,
    subject: message.subject,
    to: message.to.map((address) => address.email).join(", "),
  };
};
