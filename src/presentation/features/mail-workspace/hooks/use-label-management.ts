"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  LABEL_COLORS,
  type LabelColor,
  type MailLabel,
  type MailLabelDeletion,
} from "@/domain/mail/label";
import type { LabelId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { LabelManagementViewModel } from "@/presentation/features/mail-workspace/label-management.view-model";
import { mailApi } from "@/transport/client/api-client";

interface Options {
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly isSupported: boolean;
  readonly deletions: readonly MailLabelDeletion[];
  readonly labels: readonly MailLabel[];
  readonly refresh: () => void;
  readonly sessionScope: string;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to update this label.";

export const useLabelManagement = ({
  handleSessionFailure,
  isSupported,
  deletions,
  labels,
  refresh,
  sessionScope,
}: Options): LabelManagementViewModel => {
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [targetId, setTargetId] = useState<LabelId | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor>(LABEL_COLORS[0]);
  const [isOpen, setIsOpen] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scopeRef = useRef(sessionScope);
  const resumeAttemptRef = useRef("");

  useEffect(() => {
    scopeRef.current = sessionScope;
    setIsOpen(false);
    setIsSaving(false);
    setIsConfirmingDelete(false);
    setError(null);
    resumeAttemptRef.current = "";
  }, [sessionScope]);

  const close = useCallback(() => {
    if (isSaving) return;
    setIsOpen(false);
    setIsConfirmingDelete(false);
    setError(null);
  }, [isSaving]);
  const openCreate = useCallback(() => {
    if (!isSupported) return;
    setMode("create");
    setTargetId(null);
    setName("");
    setColor(LABEL_COLORS[0]);
    setError(null);
    setIsConfirmingDelete(false);
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
    setIsConfirmingDelete(false);
    setIsOpen(true);
  }, [isSupported, labels]);

  const runDeletion = useCallback(async (labelId: LabelId, revealErrors: boolean) => {
    const isPending = deletions.some(({ labelId: pending }) => pending === labelId);
    if (!sessionScope || isSaving || (!isSupported && !isPending)) return;
    const requestScope = sessionScope;
    setIsSaving(true);
    if (revealErrors) setError(null);
    try {
      const result = await mailApi.deleteLabel(labelId, requestScope);
      if (scopeRef.current !== requestScope) return;
      setIsConfirmingDelete(false);
      if (result.done) setIsOpen(false);
      refresh();
    } catch (nextError) {
      if (scopeRef.current !== requestScope) return;
      if (!handleSessionFailure(nextError)) {
        setError(errorMessage(nextError));
        if (revealErrors) setIsOpen(true);
      }
    } finally {
      if (scopeRef.current === requestScope) setIsSaving(false);
    }
  }, [deletions, handleSessionFailure, isSaving, isSupported, refresh, sessionScope]);

  useEffect(() => {
    const pending = deletions[0];
    if (!pending || !sessionScope || isSaving) return;
    const attempt = `${pending.labelId}:${pending.updatedAt}`;
    if (resumeAttemptRef.current === attempt) return;
    resumeAttemptRef.current = attempt;
    const timeout = window.setTimeout(() => {
      void runDeletion(pending.labelId, false);
    }, 1_600);
    return () => window.clearTimeout(timeout);
  }, [deletions, isSaving, isSupported, runDeletion, sessionScope]);

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
    deletingLabelIds: new Set(deletions.map(({ labelId }) => labelId)),
    isConfirmingDelete,
    isOpen,
    isSaving,
    isSupported,
    isTargetDeleting: targetId !== null && deletions.some(
      ({ labelId }) => labelId === targetId,
    ),
    labels,
    mode,
    name,
    onClose: close,
    onColorChange: setColor,
    onDialogKeyDown: (event) => {
      if (event.key === "Escape") close();
    },
    onDelete: () => {
      if (targetId) void runDeletion(targetId, true);
    },
    onNameChange: setName,
    onSubmit: submit,
    openCreate,
    openEdit,
    requestDelete: () => setIsConfirmingDelete(true),
    title: mode === "create" ? "Create label" : "Edit label",
  };
};
