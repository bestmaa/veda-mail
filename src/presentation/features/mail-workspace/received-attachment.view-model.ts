import type { Attachment } from "@/domain/mail/mail";
import type { AttachmentViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { formatFileSize } from "@/presentation/shared/formatters/mail-formatters";

export const createAttachmentDownloadHref = (
  messageId: string,
  attachmentId: string,
): string =>
  `/api/v1/mail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;

export const createAttachmentArchiveHref = (messageId: string): string =>
  `/api/v1/mail/messages/${encodeURIComponent(messageId)}/attachments/archive`;

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
): readonly AttachmentViewModel[] =>
  attachments.map((attachment) => ({
    href: createAttachmentDownloadHref(messageId, attachment.id),
    id: attachment.id,
    meta: `${attachment.mimeType} · ${formatFileSize(attachment.size)}`,
    name: attachment.name,
  }));
