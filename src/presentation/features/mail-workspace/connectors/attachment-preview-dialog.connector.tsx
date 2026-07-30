"use client";

import { useEffect, useRef } from "react";

import { AttachmentPreviewDialogView } from "@/presentation/features/mail-workspace/ui/attachment-preview-dialog.view";

interface AttachmentPreviewDialogConnectorProps {
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isOpen: boolean;
  readonly name: string;
  readonly onClose: () => void;
  readonly onRestoreFocus: () => void;
  readonly url: string | null;
}

export const AttachmentPreviewDialogConnector = (
  props: AttachmentPreviewDialogConnectorProps,
) => {
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const { isOpen, onClose, onRestoreFocus } = props;

  useEffect(() => {
    if (!isOpen) return;
    const element = dialog.current;
    if (!element) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!element.open) element.showModal();
    closeButton.current?.focus();
    const onCancel = (event: Event): void => {
      event.preventDefault();
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (
        event.key === "Tab" &&
        document.activeElement === closeButton.current &&
        frame.current
      ) {
        event.preventDefault();
        frame.current.focus();
      }
    };
    element.addEventListener("cancel", onCancel);
    element.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      element.removeEventListener("cancel", onCancel);
      element.removeEventListener("keydown", onKeyDown);
      if (element.open) element.close();
      onRestoreFocus();
    };
  }, [isOpen, onClose, onRestoreFocus]);

  useEffect(() => {
    const element = frame.current;
    if (!isOpen || !element || !props.url) return;
    let attachedDocument: Document | null = null;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        event.preventDefault();
        closeButton.current?.focus();
      }
    };
    const attach = (): void => {
      try {
        attachedDocument?.removeEventListener("keydown", onKeyDown);
        attachedDocument = element.contentDocument;
        attachedDocument?.addEventListener("keydown", onKeyDown);
      } catch {
        attachedDocument = null;
      }
    };
    element.addEventListener("load", attach);
    attach();
    return () => {
      element.removeEventListener("load", attach);
      attachedDocument?.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose, props.url]);

  return (
    <AttachmentPreviewDialogView
      closeButtonRef={closeButton}
      dialogRef={dialog}
      error={props.error}
      isLoading={props.isLoading}
      isOpen={props.isOpen}
      name={props.name}
      onClose={props.onClose}
      previewFrameRef={frame}
      url={props.url}
    />
  );
};
