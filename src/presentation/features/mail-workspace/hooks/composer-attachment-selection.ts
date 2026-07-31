const MAX_ATTACHMENT_COUNT = 10;
export const MAX_COMPOSER_ATTACHMENT_BYTES = 18 * 1024 * 1024;

export const composerAttachmentSelectionError = (input: {
  readonly capabilityMaximum: number | null;
  readonly file: File;
  readonly maxFileBytes: number;
  readonly selectedBytes: number;
  readonly selectedCount: number;
}): string | null =>
  input.capabilityMaximum === null
    ? "The provider attachment limit is temporarily unavailable."
    : input.capabilityMaximum <= 0
      ? "Attachments are not available for this provider."
      : input.selectedCount >= MAX_ATTACHMENT_COUNT
        ? `A message can contain at most ${MAX_ATTACHMENT_COUNT} attachments.`
        : input.file.size <= 0
          ? "Empty files cannot be attached."
          : input.file.size > input.maxFileBytes
            ? "This file exceeds the attachment size limit."
            : input.selectedBytes + input.file.size >
                MAX_COMPOSER_ATTACHMENT_BYTES
              ? "Attachments cannot exceed 18 MiB in total."
              : null;
