"use client";

import { useCallback, useState, type ChangeEventHandler } from "react";

import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { memberContactApi } from "@/transport/client/member-contact-api";

const MAX_VCARD_FILE_BYTES = 1024 * 1024;

export const useContactVCardTransfer = (
  revision: string | null,
  sessionScope: string,
  retry: () => void,
  handleSessionFailure: MailSessionFailureHandler,
) => {
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onImportFile = useCallback<ChangeEventHandler<HTMLInputElement>>(async (
    event,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !sessionScope || isImporting || isExporting) return;
    if (file.size < 1 || file.size > MAX_VCARD_FILE_BYTES) {
      setError("Choose a non-empty vCard file no larger than 1 MiB.");
      return;
    }
    setError(null);
    setIsImporting(true);
    try {
      const text = await file.text();
      await memberContactApi.importVCard(text, revision, sessionScope);
      retry();
    } catch (nextError) {
      if (!handleSessionFailure(nextError)) {
        setError(nextError instanceof Error ? nextError.message : "Unable to import contacts.");
      }
    } finally {
      setIsImporting(false);
    }
  }, [handleSessionFailure, isExporting, isImporting, retry, revision, sessionScope]);

  const onExport = useCallback(async () => {
    if (!sessionScope || isExporting || isImporting) return;
    setError(null);
    setIsExporting(true);
    try {
      const blob = await memberContactApi.exportVCard(sessionScope);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.download = "veda-mail-contacts.vcf";
      anchor.href = url;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (nextError) {
      if (!handleSessionFailure(nextError)) {
        setError(nextError instanceof Error ? nextError.message : "Unable to export contacts.");
      }
    } finally {
      setIsExporting(false);
    }
  }, [handleSessionFailure, isExporting, isImporting, sessionScope]);

  return { error, isExporting, isImporting, onExport, onImportFile };
};
