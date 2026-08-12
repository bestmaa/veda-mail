"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEventHandler } from "react";

import { MAX_SETTINGS_PORTABILITY_BYTES } from "@/domain/member/settings-portability";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { SettingsPortabilityViewModel } from "@/presentation/features/mail-workspace/settings-portability.view-model";
import { memberSettingsPortabilityApi } from "@/transport/client/member-settings-portability-api";

export const useSettingsPortabilityModel = (
  sessionScope: string,
  afterImport: () => void,
  handleSessionFailure: MailSessionFailureHandler,
): SettingsPortabilityViewModel => {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const scopeRef = useRef(sessionScope);
  useEffect(() => { scopeRef.current = sessionScope; }, [sessionScope]);

  const onSelectFile = useCallback<ChangeEventHandler<HTMLInputElement>>((event) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setError(null);
    setSuccess(null);
    if (!file) return;
    if (file.size < 1 || file.size > MAX_SETTINGS_PORTABILITY_BYTES) {
      setPendingFile(null);
      setError("Choose a non-empty Veda Mail settings file no larger than 128 KiB.");
      return;
    }
    setPendingFile(file);
  }, []);

  const confirmImport = useCallback(async () => {
    if (!pendingFile || !sessionScope || isExporting || isImporting) return;
    const requestScope = sessionScope;
    setError(null);
    setSuccess(null);
    setIsImporting(true);
    try {
      const contents = await pendingFile.text();
      await memberSettingsPortabilityApi.importFile(contents, requestScope);
      if (scopeRef.current !== requestScope) return;
      setPendingFile(null);
      setSuccess("Settings and rules imported and deployed.");
      afterImport();
    } catch (caught) {
      if (scopeRef.current !== requestScope) return;
      if (!handleSessionFailure(caught)) {
        setError(caught instanceof Error ? caught.message : "Unable to import settings.");
      }
    } finally {
      if (scopeRef.current === requestScope) setIsImporting(false);
    }
  }, [afterImport, handleSessionFailure, isExporting, isImporting, pendingFile, sessionScope]);

  const onExport = useCallback(async () => {
    if (!sessionScope || isExporting || isImporting) return;
    const requestScope = sessionScope;
    setError(null);
    setSuccess(null);
    setIsExporting(true);
    try {
      const blob = await memberSettingsPortabilityApi.exportFile(requestScope);
      if (scopeRef.current !== requestScope) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.download = "veda-mail-settings.json";
      anchor.href = url;
      anchor.click();
      URL.revokeObjectURL(url);
      setSuccess("Settings export downloaded.");
    } catch (caught) {
      if (scopeRef.current !== requestScope) return;
      if (!handleSessionFailure(caught)) {
        setError(caught instanceof Error ? caught.message : "Unable to export settings.");
      }
    } finally {
      if (scopeRef.current === requestScope) setIsExporting(false);
    }
  }, [handleSessionFailure, isExporting, isImporting, sessionScope]);

  return {
    cancelImport: () => setPendingFile(null),
    confirmImport: () => void confirmImport(),
    error,
    isExporting,
    isImporting,
    onExport: () => void onExport(),
    onSelectFile,
    pendingFileName: pendingFile?.name ?? null,
    success,
  };
};
