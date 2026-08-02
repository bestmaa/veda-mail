"use client";

import { useCallback, type Dispatch, type MutableRefObject,
  type SetStateAction } from "react";

import type { DraftId } from "@/domain/shared/brand";
import {
  markComposerAttachmentReady,
  type ComposerAttachment,
  type ComposerAttachmentUploadRegistry,
  type RemoveUploadedAttachment,
} from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { mailApi } from "@/transport/client/api-client";

export const useComposerAttachmentUpload = (input: {
  readonly currentDraftId: MutableRefObject<DraftId>;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly onChanged: () => void;
  readonly registry: ComposerAttachmentUploadRegistry;
  readonly removeUpload: RemoveUploadedAttachment;
  readonly sessionScope: string;
  readonly setAttachments: Dispatch<SetStateAction<readonly ComposerAttachment[]>>;
}) => useCallback(async (file: File) => {
  const key = crypto.randomUUID();
  const operation = input.registry.begin(key, input.currentDraftId.current);
  input.setAttachments((current) => [...current, {
    error: null, key, name: file.name, size: file.size,
    state: "uploading", upload: null,
  }]);
  try {
    const upload = await mailApi.addAttachment(
      operation.draftId, file, input.sessionScope, operation.controller.signal,
    );
    if (!await input.registry.complete(
      key, operation, upload, input.removeUpload,
    )) return;
    input.setAttachments((current) =>
      markComposerAttachmentReady(current, key, upload));
    input.onChanged();
  } catch (error) {
    input.registry.fail(key, operation);
    if (operation.controller.signal.aborted ||
      input.handleSessionFailure(error)) return;
    input.setAttachments((current) => current.map((item) => item.key === key
      ? { ...item, error: error instanceof Error ? error.message
          : "Attachment upload failed.", state: "error" }
      : item));
  }
}, [input]);
