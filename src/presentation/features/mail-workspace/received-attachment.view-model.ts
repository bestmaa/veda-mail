import type { Attachment } from "@/domain/mail/mail";
import { normalizeReceivedAttachmentMimeType } from "@/domain/mail/received-attachment";
import type { AttachmentViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { formatFileSize } from "@/presentation/shared/formatters/mail-formatters";

export const createAttachmentDownloadHref = (
  messageId: string,
  attachmentId: string,
): string =>
  `/api/v1/mail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;

export const createAttachmentArchiveHref = (messageId: string): string =>
  `/api/v1/mail/messages/${encodeURIComponent(messageId)}/attachments/archive`;

export const createAttachmentPreviewHref = (
  messageId: string,
  attachmentId: string,
): string =>
  `${createAttachmentDownloadHref(messageId, attachmentId)}/preview`;

export const canPreviewReceivedAttachment = (
  attachment: Attachment,
): boolean =>
  normalizeReceivedAttachmentMimeType(attachment.mimeType) === "text/plain";

export const createAttachmentArchiveViewModel = (
  messageId: string,
  attachmentCount: number,
  state: {
    readonly download: (href: string) => Promise<void>;
    readonly error: string | null;
    readonly href: string | null;
    readonly isPreparing: boolean;
  },
) => {
  if (attachmentCount < 2) return { downloadAll: null, error: null };
  const href = createAttachmentArchiveHref(messageId);
  return {
    downloadAll: {
      isPreparing: state.href === href && state.isPreparing,
      onClick: () => void state.download(href),
    },
    error: state.href === href ? state.error : null,
  };
};

export const createReceivedAttachmentViewModels = (
  messageId: string,
  attachments: readonly Attachment[],
  preview?: {
    readonly href: string | null;
    readonly isLoading: boolean;
    readonly open: (
      href: string,
      name: string,
      trigger: HTMLButtonElement,
    ) => Promise<void>;
  },
  download?: {
    readonly download: (href: string, name: string) => Promise<void>;
    readonly href: string | null;
    readonly isDownloading: boolean;
  },
): readonly AttachmentViewModel[] =>
  attachments.map((attachment) => {
    const href = createAttachmentDownloadHref(messageId, attachment.id);
    const previewHref = createAttachmentPreviewHref(
      messageId,
      attachment.id,
    );
    const canPreview = Boolean(
      preview && canPreviewReceivedAttachment(attachment),
    );
    return {
      href,
      id: attachment.id,
      isDownloading: Boolean(
        download && download.href === href && download.isDownloading,
      ),
      isPreviewing:
        canPreview &&
        preview?.href === previewHref &&
        preview.isLoading,
      meta: `${attachment.mimeType} · ${
        attachment.size === null
          ? "Unknown size"
          : formatFileSize(attachment.size)
      }`,
      name: attachment.name,
      onDownload: () => void download?.download(href, attachment.name),
      onPreview:
        canPreview && preview
          ? (trigger) =>
              void preview.open(previewHref, attachment.name, trigger)
          : null,
    };
  });
