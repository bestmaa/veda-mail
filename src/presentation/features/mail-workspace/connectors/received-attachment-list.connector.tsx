"use client";

import { useEffect, useRef } from "react";

import type { AttachmentViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { ReceivedAttachmentListView } from "@/presentation/features/mail-workspace/ui/received-attachment-list.view";

interface DownloadAllViewModel {
  readonly error: string | null;
  readonly isPreparing: boolean;
  readonly onClick: () => void;
}

export const ReceivedAttachmentListConnector = ({
  attachments,
  downloadAll,
}: {
  readonly attachments: readonly AttachmentViewModel[];
  readonly downloadAll: DownloadAllViewModel | null;
}) => {
  const downloadAllButton = useRef<HTMLButtonElement>(null);
  const restoreDownloadAllFocus = useRef(false);
  const isPreparing = downloadAll?.isPreparing ?? false;
  useEffect(() => {
    if (!isPreparing) return;
    const cancelRestore = (event: FocusEvent): void => {
      if (event.target !== downloadAllButton.current) {
        restoreDownloadAllFocus.current = false;
      }
    };
    document.addEventListener("focusin", cancelRestore);
    return () => document.removeEventListener("focusin", cancelRestore);
  }, [isPreparing]);
  useEffect(() => {
    if (isPreparing || !restoreDownloadAllFocus.current) return;
    restoreDownloadAllFocus.current = false;
    if (downloadAllButton.current?.isConnected) {
      downloadAllButton.current.focus();
    }
  }, [isPreparing]);
  const connectedDownloadAll = downloadAll ? {
    ...downloadAll,
    onClick: () => {
      restoreDownloadAllFocus.current =
        downloadAllButton.current === document.activeElement;
      downloadAll.onClick();
    },
  } : null;
  return (
    <ReceivedAttachmentListView
      attachments={attachments}
      downloadAll={connectedDownloadAll}
      downloadAllButtonRef={downloadAllButton}
    />
  );
};
