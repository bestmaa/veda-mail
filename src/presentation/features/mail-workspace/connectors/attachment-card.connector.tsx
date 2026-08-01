"use client";

import { useEffect, useRef } from "react";

import type { AttachmentViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { AttachmentCardView } from "@/presentation/features/mail-workspace/ui/attachment-card.view";

export const AttachmentCardConnector = ({
  attachment,
}: {
  readonly attachment: AttachmentViewModel;
}) => {
  const downloadButton = useRef<HTMLButtonElement>(null);
  const restoreDownloadFocus = useRef(false);
  useEffect(() => {
    if (!attachment.isDownloading) return;
    const cancelRestore = (event: FocusEvent): void => {
      if (event.target !== downloadButton.current) {
        restoreDownloadFocus.current = false;
      }
    };
    document.addEventListener("focusin", cancelRestore);
    return () => document.removeEventListener("focusin", cancelRestore);
  }, [attachment.isDownloading]);
  useEffect(() => {
    if (attachment.isDownloading || !restoreDownloadFocus.current) return;
    restoreDownloadFocus.current = false;
    if (downloadButton.current?.isConnected) downloadButton.current.focus();
  }, [attachment.isDownloading]);
  return (
    <AttachmentCardView
      attachment={attachment}
      downloadButtonRef={downloadButton}
      onDownload={(event) => {
        restoreDownloadFocus.current =
          event.currentTarget === document.activeElement;
        attachment.onDownload();
      }}
    />
  );
};
