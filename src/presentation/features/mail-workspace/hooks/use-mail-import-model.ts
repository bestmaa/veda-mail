"use client";

import { useCallback, useEffect, useState, type ChangeEventHandler } from "react";

import { MAX_MESSAGE_SOURCE_IMPORT_BYTES } from "@/domain/mail/message-source";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { MailImportViewModel } from "@/presentation/features/mail-workspace/mail-import.view-model";
import type { MailRuleChoice } from "@/presentation/features/mail-workspace/mail-rules.view-model";
import { messageSourceImportApi } from "@/transport/client/message-source-import-api";

const MAX_FILES = 20;

export const useMailImportModel = (
  sessionScope: string,
  mailboxes: readonly MailRuleChoice[],
  afterImport: () => void,
  handleSessionFailure: MailSessionFailureHandler,
): MailImportViewModel => {
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id ?? "");
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState({ imported: 0, total: 0 });

  useEffect(() => {
    if (!mailboxes.some(({ id }) => id === mailboxId)) {
      setMailboxId(mailboxes[0]?.id ?? "");
    }
  }, [mailboxId, mailboxes]);

  const onFiles = useCallback<ChangeEventHandler<HTMLInputElement>>(async (event) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length || !mailboxId || !sessionScope || isImporting) return;
    setError(null); setSuccess(null); setProgress({ imported: 0, total: files.length });
    if (files.length > MAX_FILES) {
      setError(`Choose at most ${MAX_FILES} .eml files at once.`);
      return;
    }
    const invalid = files.find((file) =>
      file.size < 1 || file.size > MAX_MESSAGE_SOURCE_IMPORT_BYTES ||
      !file.name.toLowerCase().endsWith(".eml"));
    if (invalid) {
      setError("Every file must be a non-empty .eml no larger than 18 MiB.");
      return;
    }
    setIsImporting(true);
    let imported = 0;
    try {
      for (const file of files) {
        await messageSourceImportApi.import(file, mailboxId, sessionScope);
        imported += 1;
        setProgress({ imported, total: files.length });
      }
      setSuccess(`${imported} message${imported === 1 ? "" : "s"} imported.`);
      afterImport();
    } catch (caught) {
      if (!handleSessionFailure(caught)) {
        const detail = caught instanceof Error ? caught.message : "Message import failed.";
        setError(`${imported} of ${files.length} messages imported. ${detail}`);
      }
      if (imported > 0) afterImport();
    } finally {
      setIsImporting(false);
    }
  }, [afterImport, handleSessionFailure, isImporting, mailboxId, sessionScope]);

  return {
    error,
    imported: progress.imported,
    isImporting,
    mailboxes,
    mailboxId,
    mailboxInput: (event) => setMailboxId(event.target.value),
    onFiles,
    success,
    total: progress.total,
  };
};
