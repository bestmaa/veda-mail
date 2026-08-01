"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  LABEL_COLORS,
  type LabelColor,
  type MailLabel,
} from "@/domain/mail/label";
import type { LabelId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { LabelManagementViewModel } from "@/presentation/features/mail-workspace/label-management.view-model";
import { mailApi } from "@/transport/client/api-client";

interface Options {
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly isSupported: boolean;
  readonly labels: readonly MailLabel[];
  readonly refresh: () => void;
  readonly sessionScope: string;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to save this label.";

export const useLabelManagement = ({
  handleSessionFailure,
  isSupported,
  labels,
  refresh,
  sessionScope,
}: Options): LabelManagementViewModel => {
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [targetId, setTargetId] = useState<LabelId | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor>(LABEL_COLORS[0]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scopeRef = useRef(sessionScope);

  useEffect(() => {
    scopeRef.current = sessionScope;
    setIsOpen(false);
    setIsSaving(false);
    setError(null);
  }, [sessionScope]);

  const close = useCallback(() => {
    if (isSaving) return;
    setIsOpen(false);
    setError(null);
  }, [isSaving]);
  const openCreate = useCallback(() => {
    if (!isSupported) return;
    setMode("create");
    setTargetId(null);
    setName("");
    setColor(LABEL_COLORS[0]);
    setError(null);
    setIsOpen(true);
  }, [isSupported]);
  const openEdit = useCallback((labelId: string) => {
    const label = labels.find(({ id: value }) => value === labelId);
    if (!label || !isSupported) return;
    setMode("edit");
    setTargetId(label.id);
    setName(label.name);
    setColor(label.color);
    setError(null);
    setIsOpen(true);
  }, [isSupported, labels]);

  const submit: LabelManagementViewModel["onSubmit"] = useCallback(async (event) => {
    event.preventDefault();
    if (!sessionScope || !isSupported || isSaving) return;
    const requestScope = sessionScope;
    setIsSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        await mailApi.createLabel({ color, name }, requestScope);
      } else {
        await mailApi.updateLabel({ color, labelId: targetId!, name }, requestScope);
      }
      if (scopeRef.current !== requestScope) return;
      setIsOpen(false);
      refresh();
    } catch (nextError) {
      if (scopeRef.current !== requestScope) return;
      if (!handleSessionFailure(nextError)) setError(errorMessage(nextError));
    } finally {
      if (scopeRef.current === requestScope) setIsSaving(false);
    }
  }, [color, handleSessionFailure, isSaving, isSupported, mode, name,
    refresh, sessionScope, targetId]);

  return {
    color,
    colors: LABEL_COLORS,
    error,
    isOpen,
    isSaving,
    isSupported,
    labels,
    mode,
    name,
    onClose: close,
    onColorChange: setColor,
    onDialogKeyDown: (event) => {
      if (event.key === "Escape") close();
    },
    onNameChange: setName,
    onSubmit: submit,
    openCreate,
    openEdit,
    title: mode === "create" ? "Create label" : "Edit label",
  };
};
