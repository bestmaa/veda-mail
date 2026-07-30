import type { ComposerAttachment } from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";
import type { ComposerAttachmentViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { formatFileSize } from "@/presentation/shared/formatters/mail-formatters";

const attachmentStatus = (attachment: ComposerAttachment): string => {
  if (attachment.state === "ready") {
    return attachment.upload?.mimeType ?? "Ready";
  }
  if (attachment.state === "error") {
    return attachment.source ? "Copy failed" : "Upload failed";
  }
  return attachment.source ? "Copying and scanning…" : "Scanning…";
};

export const createComposerAttachmentViewModel = (
  attachment: ComposerAttachment,
  remove: (key: string) => void,
  retry: (key: string) => void,
): ComposerAttachmentViewModel => ({
  error: attachment.error,
  id: attachment.key,
  meta: `${
    attachment.size === null
      ? "Unknown size"
      : formatFileSize(attachment.size)
  } · ${attachmentStatus(attachment)}`,
  name: attachment.name,
  onRemove: () => remove(attachment.key),
  ...(attachment.source
    ? { onRetry: () => retry(attachment.key) }
    : {}),
  state: attachment.state,
});
