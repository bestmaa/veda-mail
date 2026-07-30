"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEventHandler,
} from "react";
import type { UploadedAttachment } from "@/domain/mail/mail";
import { id, type DraftId } from "@/domain/shared/brand";
import {
  ComposerAttachmentUploadRegistry,
  expireComposerAttachments,
  invalidateReadyComposerAttachments,
  markComposerAttachmentReady,
  type ComposerAttachment,
} from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";
import { useAttachmentCapability } from "@/presentation/features/mail-workspace/hooks/use-attachment-capability";
import { useComposerOriginalAttachmentImports } from "@/presentation/features/mail-workspace/hooks/use-composer-original-attachment-imports";
import { mailApi } from "@/transport/client/api-client";

const MAX_ATTACHMENT_COUNT = 10;
const MAX_TOTAL_BYTES = 18 * 1024 * 1024;

const freshDraftId = (): DraftId => id.draft(crypto.randomUUID());
const removeUploadedAttachment = (
  draftId: DraftId,
  attachmentId: UploadedAttachment["id"],
) => mailApi.removeAttachment(draftId, attachmentId);

export const useComposerAttachments = (
  initialProviderMaxBytes: number | null,
) => {
  const [draftId, setDraftId] = useState(freshDraftId);
  const [attachments, setAttachments] = useState<readonly ComposerAttachment[]>(
    [],
  );
  const uploads = useRef(new ComposerAttachmentUploadRegistry());
  const { importOriginalAttachments, retryOriginalAttachment } =
    useComposerOriginalAttachmentImports(uploads.current, setAttachments);
  const capability = useAttachmentCapability(initialProviderMaxBytes);
  const ready = attachments.flatMap((item) =>
    item.state === "ready" && item.upload ? [item.upload] : [],
  );
  const totalBytes = attachments.reduce((total, item) => total + item.size, 0);
  const maxFileBytes = Math.min(capability.maximum ?? 0, MAX_TOTAL_BYTES);

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
          .removeAttachment(operation?.draftId ?? draftId, upload.id)
          .catch(() => undefined);
      }
    },
    [attachments, draftId],
  );

  const discard = useCallback(
    (cleanup: boolean) => {
      const operations = uploads.current.cancelAll();
      if (cleanup) {
        const completed = operations.flatMap((operation) =>
          operation.upload ? [operation.upload] : [],
        );
        const completedIds = new Set(completed.map((upload) => upload.id));
        for (const upload of [
          ...completed,
          ...ready.filter((upload) => !completedIds.has(upload.id)),
        ]) {
          void mailApi
            .removeAttachment(draftId, upload.id)
            .catch(() => undefined);
        }
      }
      setAttachments([]);
      const nextDraftId = freshDraftId();
      setDraftId(nextDraftId);
      return nextDraftId;
    },
    [draftId, ready],
  );

  const retry = useCallback(
    (key: string) => {
      const target = attachments.find((item) => item.key === key);
      if (target) retryOriginalAttachment(target, draftId);
    },
    [attachments, draftId, retryOriginalAttachment],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      const key = crypto.randomUUID();
      const operation = uploads.current.begin(key, draftId);
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
          draftId,
          file,
          operation.controller.signal,
        );
        const isActive = await uploads.current.complete(
          key,
          operation,
          upload,
          removeUploadedAttachment,
        );
        if (!isActive) return;
        setAttachments((current) =>
          markComposerAttachmentReady(current, key, upload),
        );
      } catch (error) {
        uploads.current.fail(key, operation);
        if (operation.controller.signal.aborted) return;
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
    [draftId],
  );

  const onFiles: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      const files = [...(event.currentTarget.files ?? [])];
      event.currentTarget.value = "";
      let selectedCount = attachments.length;
      let selectedBytes = totalBytes;
      for (const file of files) {
        const invalid =
          capability.maximum === null
            ? "The provider attachment limit is temporarily unavailable."
            : capability.maximum <= 0
              ? "Attachments are not available for this provider."
              : selectedCount >= MAX_ATTACHMENT_COUNT
                ? `A message can contain at most ${MAX_ATTACHMENT_COUNT} attachments.`
                : file.size <= 0
                  ? "Empty files cannot be attached."
                  : file.size > maxFileBytes
                    ? "This file exceeds the attachment size limit."
                    : selectedBytes + file.size > MAX_TOTAL_BYTES
                      ? "Attachments cannot exceed 18 MiB in total."
                      : null;
        if (invalid) {
          const key = crypto.randomUUID();
          setAttachments((current) => [
            ...current,
            {
              error: invalid,
              key,
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
      capability.maximum,
      maxFileBytes,
      totalBytes,
      uploadFile,
    ],
  );

  return useMemo(
    () => ({
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
