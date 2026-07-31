"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { id, type DraftId } from "@/domain/shared/brand";
import {
  ComposerAttachmentUploadRegistry,
  cleanupComposerAttachmentOperations,
  expireComposerAttachments,
  invalidateReadyComposerAttachments,
  markComposerAttachmentReady,
  type ComposerAttachment,
  type RemoveUploadedAttachment,
} from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";
import { useAttachmentCapability } from "@/presentation/features/mail-workspace/hooks/use-attachment-capability";
import { MAX_COMPOSER_ATTACHMENT_BYTES } from "@/presentation/features/mail-workspace/hooks/composer-attachment-selection";
import { useComposerAttachmentSelection } from "@/presentation/features/mail-workspace/hooks/use-composer-attachment-selection";
import { useComposerOriginalAttachmentImports } from "@/presentation/features/mail-workspace/hooks/use-composer-original-attachment-imports";
import {
  ignoreMailSessionFailure,
  type MailSessionFailureHandler,
} from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { mailApi } from "@/transport/client/api-client";

const freshDraftId = (): DraftId => id.draft(crypto.randomUUID());
const removeUploadedAttachment = (
  sessionScope: string,
  handleSessionFailure: MailSessionFailureHandler,
): RemoveUploadedAttachment => async (draftId, attachmentId) => {
  try {
    await mailApi.removeAttachment(draftId, attachmentId, sessionScope);
  } catch (error) {
    handleSessionFailure(error);
    throw error;
  }
};

export const useComposerAttachments = (
  initialProviderMaxBytes: number | null,
  sessionScope: string,
  initialSessionScope = "",
  handleSessionFailure: MailSessionFailureHandler = ignoreMailSessionFailure,
) => {
  const [draftId, setDraftId] = useState(freshDraftId);
  const currentDraftId = useRef(draftId);
  const [attachments, setAttachments] = useState<readonly ComposerAttachment[]>(
    [],
  );
  const uploads = useRef(new ComposerAttachmentUploadRegistry());
  const { importOriginalAttachments, retryOriginalAttachment } =
    useComposerOriginalAttachmentImports(
      uploads.current,
      setAttachments,
      sessionScope,
      handleSessionFailure,
    );
  const capability = useAttachmentCapability(
    initialProviderMaxBytes,
    sessionScope,
    initialSessionScope,
    handleSessionFailure,
  );
  const removeUpload = useMemo(
    () => removeUploadedAttachment(sessionScope, handleSessionFailure),
    [handleSessionFailure, sessionScope],
  );
  const ready = attachments.flatMap((item) =>
    item.state === "ready" && item.upload ? [item.upload] : [],
  );
  const totalBytes = attachments.reduce((total, item) => total + (item.size ?? 0), 0);
  const maxFileBytes = Math.min(
    capability.maximum ?? 0,
    MAX_COMPOSER_ATTACHMENT_BYTES,
  );

  const adoptDraftId = useCallback((nextDraftId: DraftId) => {
    currentDraftId.current = nextDraftId;
    setDraftId(nextDraftId);
  }, []);

  const expireReady = useCallback(() => {
    const next = expireComposerAttachments(attachments, Date.now());
    if (next.every((item, index) => item === attachments[index])) return false;
    setAttachments(next);
    return true;
  }, [attachments]);

  const invalidateReady = useCallback((message: string) => {
    setAttachments((current) =>
      invalidateReadyComposerAttachments(current, message),
    );
  }, []);

  const remove = useCallback(
    (key: string) => {
      const target = attachments.find((item) => item.key === key);
      const operation = uploads.current.cancel(key);
      setAttachments((current) => current.filter((item) => item.key !== key));
      const upload = operation?.upload ?? target?.upload;
      if (upload) {
        void mailApi
          .removeAttachment(
            operation?.draftId ?? currentDraftId.current,
            upload.id,
            sessionScope,
          )
          .catch((error: unknown) => void handleSessionFailure(error));
      }
    },
    [attachments, handleSessionFailure, sessionScope],
  );

  const discard = useCallback(
    (cleanup: boolean) => {
      const operations = uploads.current.cancelAll();
      if (cleanup) {
        const completedIds = cleanupComposerAttachmentOperations(
          operations,
          removeUpload,
        );
        for (const upload of ready) {
          if (completedIds.has(upload.id)) continue;
          void removeUpload(currentDraftId.current, upload.id).catch(
            () => undefined,
          );
        }
      }
      setAttachments([]);
      const nextDraftId = freshDraftId();
      currentDraftId.current = nextDraftId;
      setDraftId(nextDraftId);
      return nextDraftId;
    },
    [ready, removeUpload],
  );

  const retry = useCallback(
    (key: string) => {
      const target = attachments.find((item) => item.key === key);
      if (target) retryOriginalAttachment(target, currentDraftId.current);
    },
    [attachments, retryOriginalAttachment],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      const key = crypto.randomUUID();
      const operation = uploads.current.begin(key, currentDraftId.current);
      setAttachments((current) => [
        ...current,
        {
          error: null,
          key,
          name: file.name,
          size: file.size,
          state: "uploading",
          upload: null,
        },
      ]);
      try {
        const upload = await mailApi.addAttachment(
          operation.draftId,
          file,
          sessionScope,
          operation.controller.signal,
        );
        const isActive = await uploads.current.complete(
          key,
          operation,
          upload,
          removeUpload,
        );
        if (!isActive) return;
        setAttachments((current) =>
          markComposerAttachmentReady(current, key, upload),
        );
      } catch (error) {
        uploads.current.fail(key, operation);
        if (operation.controller.signal.aborted) return;
        if (handleSessionFailure(error)) return;
        setAttachments((current) =>
          current.map((item) =>
            item.key === key
              ? {
                  ...item,
                  error:
                    error instanceof Error
                      ? error.message
                      : "Attachment upload failed.",
                  state: "error",
                }
              : item,
          ),
        );
      }
    },
    [handleSessionFailure, removeUpload, sessionScope],
  );

  const onFiles = useComposerAttachmentSelection({
    attachments,
    capabilityMaximum: capability.maximum,
    maxFileBytes,
    setAttachments,
    totalBytes,
    uploadFile,
  });

  return useMemo(
    () => ({
      adoptDraftId,
      attachments,
      attachmentIds: ready.map((item) => item.id),
      capabilityUnavailable: capability.unavailable,
      discard,
      draftId,
      expireReady,
      hasError: attachments.some((item) => item.state === "error"),
      importOriginalAttachments,
      invalidateReady,
      isCapabilityRefreshing: capability.isRefreshing,
      isUploading: attachments.some((item) => item.state === "uploading"),
      maxFileBytes,
      onFiles,
      refreshCapability: capability.refresh,
      remove,
      retry,
    }),
    [
      attachments,
      adoptDraftId,
      capability.isRefreshing,
      capability.refresh,
      capability.unavailable,
      discard,
      draftId,
      expireReady,
      invalidateReady,
      maxFileBytes,
      onFiles,
      importOriginalAttachments,
      ready,
      remove,
      retry,
    ],
  );
};
