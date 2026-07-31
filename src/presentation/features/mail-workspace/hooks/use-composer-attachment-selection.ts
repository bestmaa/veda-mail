"use client";

import {
  useCallback,
  type ChangeEventHandler,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  composerAttachmentSelectionError,
} from "@/presentation/features/mail-workspace/hooks/composer-attachment-selection";
import type { ComposerAttachment } from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";

interface ComposerAttachmentSelectionOptions {
  readonly attachments: readonly ComposerAttachment[];
  readonly capabilityMaximum: number | null;
  readonly maxFileBytes: number;
  readonly setAttachments: Dispatch<
    SetStateAction<readonly ComposerAttachment[]>
  >;
  readonly totalBytes: number;
  readonly uploadFile: (file: File) => Promise<void>;
}

export const useComposerAttachmentSelection = ({
  attachments,
  capabilityMaximum,
  maxFileBytes,
  setAttachments,
  totalBytes,
  uploadFile,
}: ComposerAttachmentSelectionOptions): ChangeEventHandler<HTMLInputElement> =>
  useCallback(
    (event) => {
      const files = [...(event.currentTarget.files ?? [])];
      event.currentTarget.value = "";
      let selectedCount = attachments.length;
      let selectedBytes = totalBytes;
      for (const file of files) {
        const invalid = composerAttachmentSelectionError({
          capabilityMaximum,
          file,
          maxFileBytes,
          selectedBytes,
          selectedCount,
        });
        if (invalid) {
          setAttachments((current) => [
            ...current,
            {
              error: invalid,
              key: crypto.randomUUID(),
              name: file.name,
              size: file.size,
              state: "error",
              upload: null,
            },
          ]);
          continue;
        }
        selectedCount += 1;
        selectedBytes += file.size;
        void uploadFile(file);
      }
    },
    [
      attachments.length,
      capabilityMaximum,
      maxFileBytes,
      setAttachments,
      totalBytes,
      uploadFile,
    ],
  );
