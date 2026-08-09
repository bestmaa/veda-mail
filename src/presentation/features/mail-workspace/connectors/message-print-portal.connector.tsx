"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type { MessagePrintViewModel } from "@/presentation/features/mail-workspace/message-print.view-model";
import { MessagePrintDocumentView } from "@/presentation/features/mail-workspace/ui/message-print-document.view";

export const MessagePrintPortalConnector = ({
  print,
}: {
  readonly print: MessagePrintViewModel;
}) => {
  const { document: printDocument, locale, onPrinted, timeZone } = print;
  const scheduledDocument = useRef(printDocument);
  useEffect(() => {
    const current = printDocument;
    if (!current || scheduledDocument.current === current) return;
    let secondFrame = 0;
    const printed = () => onPrinted();
    window.addEventListener("afterprint", printed, { once: true });
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        scheduledDocument.current = current;
        window.print();
      });
    });
    return () => {
      window.removeEventListener("afterprint", printed);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [onPrinted, printDocument]);
  if (!printDocument || typeof document === "undefined") return null;
  return createPortal(
    <MessagePrintDocumentView
      document={printDocument}
      locale={locale}
      timeZone={timeZone}
    />,
    document.body,
  );
};
