"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";

import { selectForwardableOriginalAttachments } from "@/domain/mail/compose";
import type { MessageDetail, UploadedAttachment } from "@/domain/mail/mail";
import type { DraftId } from "@/domain/shared/brand";
import { markComposerAttachmentReady } from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";
import type {
  ComposerAttachmentUploadRegistry,
  ComposerAttachment,
  ComposerAttachmentUploadOperation,
} from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";
import { mailApi } from "@/transport/client/api-client";

interface OriginalAttachmentImportJob {
  readonly item: ComposerAttachment & {
    readonly source: NonNullable<ComposerAttachment["source"]>;
  };
  readonly operation: ComposerAttachmentUploadOperation;
}

type SetAttachments = Dispatch<
  SetStateAction<readonly ComposerAttachment[]>
>;

const removeImportedAttachment = (
  draftId: DraftId,
  attachmentId: UploadedAttachment["id"],
) => mailApi.removeAttachment(draftId, attachmentId);

const importErrorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "The original attachment could not be copied. Retry or remove it.";

export const useComposerOriginalAttachmentImports = (
  registry: ComposerAttachmentUploadRegistry,
  setAttachments: SetAttachments,
) => {
  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(
    () => () => {
      for (const operation of registry.cancelAll()) {
        if (operation.upload) {
          void removeImportedAttachment(
            operation.draftId,
            operation.upload.id,
          ).catch(() => undefined);
        }
      }
    },
    [registry],
  );

  const execute = useCallback(
    async ({ item, operation }: OriginalAttachmentImportJob) => {
      try {
        const upload = await mailApi.importAttachment(
          operation.draftId,
          item.source.messageId,
          item.source.attachmentId,
          operation.controller.signal,
        );
        const isActive = await registry.complete(
          item.key,
          operation,
          upload,
          removeImportedAttachment,
        );
        if (!isActive) return;
        setAttachments((current) =>
          markComposerAttachmentReady(current, item.key, upload),
        );
      } catch (error) {
        registry.fail(item.key, operation);
        if (operation.controller.signal.aborted) return;
        setAttachments((current) =>
          current.map((candidate) =>
            candidate.key === item.key
              ? {
                  ...candidate,
                  error: importErrorMessage(error),
                  state: "error",
                }
              : candidate,
          ),
        );
      }
    },
    [registry, setAttachments],
  );

  const enqueue = useCallback(
    (job: OriginalAttachmentImportJob) => {
      const run = async () => {
        if (job.operation.controller.signal.aborted) return;
        await execute(job);
      };
      queue.current = queue.current.then(run, run);
    },
    [execute],
  );

  const importOriginalAttachments = useCallback(
    (message: MessageDetail, draftId: DraftId) => {
      const jobs: OriginalAttachmentImportJob[] =
        selectForwardableOriginalAttachments(message).map((attachment) => {
          const key = crypto.randomUUID();
          const item = {
            error: null,
            key,
            name: attachment.name,
            size: attachment.size,
            source: {
              attachmentId: attachment.id,
              messageId: message.id,
            },
            state: "uploading" as const,
            upload: null,
          };
          return {
            item,
            operation: registry.begin(key, draftId),
          };
        });
      if (jobs.length === 0) return;
      setAttachments((current) => [
        ...current,
        ...jobs.map(({ item }) => item),
      ]);
      for (const job of jobs) enqueue(job);
    },
    [enqueue, registry, setAttachments],
  );

  const retryOriginalAttachment = useCallback(
    (item: ComposerAttachment, draftId: DraftId) => {
      if (!item.source) return;
      const previous = registry.cancel(item.key);
      const previousUpload = previous?.upload ?? item.upload;
      const operation = registry.begin(item.key, draftId);
      const job = {
        item: {
          ...item,
          error: null,
          state: "uploading" as const,
          upload: null,
        },
        operation,
      } as OriginalAttachmentImportJob;
      setAttachments((current) =>
        current.map((candidate) =>
          candidate.key === item.key ? job.item : candidate,
        ),
      );
      if (previousUpload) {
        void removeImportedAttachment(
          previous?.draftId ?? draftId,
          previousUpload.id,
        ).catch(() => undefined);
      }
      enqueue(job);
    },
    [enqueue, registry, setAttachments],
  );

  return { importOriginalAttachments, retryOriginalAttachment };
};
