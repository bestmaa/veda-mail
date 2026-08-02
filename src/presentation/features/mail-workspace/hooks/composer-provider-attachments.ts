import type { DraftDetail } from "@/domain/mail/draft";
import type { ComposerAttachment } from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";

const item = (
  provider: NonNullable<DraftDetail["attachments"]>[number],
): ComposerAttachment => ({
  error: null,
  key: provider.id,
  name: provider.name,
  provider,
  size: provider.size,
  state: "ready",
  upload: null,
});

export const providerComposerAttachments = (
  draft: DraftDetail,
): readonly ComposerAttachment[] => (draft.attachments ?? []).map(item);

export const reconcileComposerProviderAttachments = (
  current: readonly ComposerAttachment[],
  draft: DraftDetail,
  submittedUploadIds: readonly string[],
  submittedProviderIds: readonly string[],
): { readonly attachments: readonly ComposerAttachment[];
  readonly replacedKeys: readonly string[] } => {
  const saved = draft.attachments ?? [];
  const retained = saved.slice(0, submittedProviderIds.length);
  const uploaded = saved.slice(submittedProviderIds.length);
  const replacedKeys: string[] = [];
  const attachments = current.flatMap((entry) => {
    const providerIndex = entry.provider
      ? submittedProviderIds.indexOf(entry.provider.id) : -1;
    const uploadIndex = entry.upload
      ? submittedUploadIds.indexOf(entry.upload.id) : -1;
    const replacement = providerIndex >= 0
      ? retained[providerIndex]
      : uploadIndex >= 0 ? uploaded[uploadIndex] : undefined;
    if (providerIndex < 0 && uploadIndex < 0) return [entry];
    replacedKeys.push(entry.key);
    return replacement ? [item(replacement)] : [];
  });
  return { attachments, replacedKeys };
};
