"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Mailbox } from "@/domain/mail/mail";
import { MAILBOX_COLORS, type MailboxColor } from "@/domain/mail/mailbox";
import { id, type MailboxId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { MailboxManagementViewModel } from "@/presentation/features/mail-workspace/mailbox-management.view-model";
import { flattenMailboxTree } from "@/presentation/features/mail-workspace/mailbox-tree.view-model";
import { mailApi } from "@/transport/client/api-client";

interface Options {
  readonly activeMailboxId: MailboxId | null;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly mailboxes: readonly Mailbox[];
  readonly refresh: () => void;
  readonly selectMailbox: (mailboxId: string) => void;
  readonly sessionScope: string;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to update this mailbox.";

export const useMailboxManagement = ({
  activeMailboxId,
  handleSessionFailure,
  mailboxes,
  refresh,
  selectMailbox,
  sessionScope,
}: Options): MailboxManagementViewModel => {
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [targetId, setTargetId] = useState<MailboxId | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<MailboxColor>("#64748b");
  const [parentId, setParentId] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const scopeRef = useRef(sessionScope);
  useEffect(() => {
    scopeRef.current = sessionScope;
    setIsOpen(false);
    setIsSaving(false);
  }, [sessionScope]);

  const target = mailboxes.find(({ id: mailboxId }) => mailboxId === targetId);
  const excluded = useMemo(() => {
    const values = new Set<string>(targetId ? [targetId] : []);
    let changed = true;
    while (changed) {
      changed = false;
      for (const mailbox of mailboxes) {
        if (mailbox.parentId && values.has(mailbox.parentId) && !values.has(mailbox.id)) {
          values.add(mailbox.id);
          changed = true;
        }
      }
    }
    return values;
  }, [mailboxes, targetId]);
  const parentOptions = useMemo(
    () => flattenMailboxTree(mailboxes)
      .filter(({ mailbox }) =>
        mailbox.rights.mayCreateChild && !excluded.has(mailbox.id),
      )
      .map(({ depth, mailbox }) => ({
        id: mailbox.id,
        label: `${"— ".repeat(depth)}${mailbox.name}`,
      })),
    [excluded, mailboxes],
  );

  const close = useCallback(() => {
    if (isSaving) return;
    setIsOpen(false);
    setDeleteConfirmationOpen(false);
    setError(null);
  }, [isSaving]);
  const openCreate = useCallback((initialParentId = "") => {
    setMode("create");
    setTargetId(null);
    setName("");
    setColor("#64748b");
    setParentId(initialParentId);
    setDeleteConfirmationOpen(false);
    setError(null);
    setIsOpen(true);
  }, []);
  const openEdit = useCallback((mailboxId: string) => {
    const mailbox = mailboxes.find(({ id: value }) => value === mailboxId);
    if (!mailbox || mailbox.role !== "custom") return;
    setMode("edit");
    setTargetId(mailbox.id);
    setName(mailbox.name);
    setColor(MAILBOX_COLORS.includes(mailbox.color as MailboxColor)
      ? mailbox.color as MailboxColor
      : "#64748b");
    setParentId(mailbox.parentId ?? "");
    setDeleteConfirmationOpen(false);
    setError(null);
    setIsOpen(true);
  }, [mailboxes]);

  const complete = useCallback((previousId: MailboxId | null, nextId: MailboxId | null) => {
    if (previousId && activeMailboxId === previousId) {
      const fallback = nextId ?? mailboxes.find(({ role }) => role === "inbox")?.id;
      if (fallback && fallback !== activeMailboxId) selectMailbox(fallback);
      else refresh();
    } else {
      refresh();
    }
    setIsOpen(false);
  }, [activeMailboxId, mailboxes, refresh, selectMailbox]);

  const submit: MailboxManagementViewModel["onSubmit"] = useCallback(async (event) => {
    event.preventDefault();
    if (!sessionScope || isSaving) return;
    const requestScope = sessionScope;
    setIsSaving(true);
    setError(null);
    try {
      const result = mode === "create"
        ? await mailApi.createMailbox({
            color,
            name,
            parentId: parentId ? id.mailbox(parentId) : null,
          }, requestScope)
        : await mailApi.updateMailbox({
            color,
            mailboxId: targetId!,
            name,
            parentId: parentId ? id.mailbox(parentId) : null,
          }, requestScope);
      if (scopeRef.current !== requestScope) return;
      if (!result.appearanceSaved) {
        setError("Folder saved, but its custom color could not be stored. Try saving again.");
        if (result.mailboxId) {
          setMode("edit");
          setTargetId(result.mailboxId);
        }
        refresh();
        return;
      }
      complete(targetId, result.mailboxId);
    } catch (nextError) {
      if (scopeRef.current !== requestScope) return;
      if (!handleSessionFailure(nextError)) setError(message(nextError));
    } finally {
      if (scopeRef.current === requestScope) setIsSaving(false);
    }
  }, [color, complete, handleSessionFailure, isSaving, mode, name,
    parentId, refresh, sessionScope, targetId]);

  const confirmDelete = useCallback(async () => {
    if (!sessionScope || !targetId || isSaving) return;
    const requestScope = sessionScope;
    setIsSaving(true);
    setError(null);
    try {
      await mailApi.deleteMailbox(targetId, requestScope);
      if (scopeRef.current === requestScope) complete(targetId, null);
    } catch (nextError) {
      if (scopeRef.current !== requestScope) return;
      if (!handleSessionFailure(nextError)) setError(message(nextError));
    } finally {
      if (scopeRef.current === requestScope) {
        setIsSaving(false);
        setDeleteConfirmationOpen(false);
      }
    }
  }, [complete, handleSessionFailure, isSaving, sessionScope, targetId]);

  return {
    canDelete: Boolean(
      target?.rights.mayDelete &&
      target.total === 0 &&
      !mailboxes.some(({ parentId: candidateParentId }) =>
        candidateParentId === target.id,
      ),
    ),
    color, colors: MAILBOX_COLORS, deleteConfirmationOpen, error, isOpen,
    isSaving, mode, name,
    onCancelDelete: () => setDeleteConfirmationOpen(false),
    onClose: close,
    onColorChange: setColor,
    onConfirmDelete: () => void confirmDelete(),
    onDialogKeyDown: (event) => {
      if (event.key === "Escape") close();
    },
    onNameChange: setName,
    onParentChange: setParentId,
    onRequestDelete: () => setDeleteConfirmationOpen(true),
    onSubmit: submit,
    openCreate, openEdit, parentId, parentOptions,
    title: mode === "create" ? "Create mailbox" : "Edit mailbox",
  };
};
