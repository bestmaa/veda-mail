"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Mailbox, MessageSummary } from "@/domain/mail/mail";
import type { MailboxId, MessageId } from "@/domain/shared/brand";
import type { BulkMessageAction } from "@/presentation/features/mail-workspace/hooks/use-mail-bulk-selection";
import {
  messageMoveTargets,
  resolveDraggedMessageIds,
} from "@/presentation/features/mail-workspace/message-move-policy";

export const VEDA_MESSAGE_DRAG_TYPE = "application/x-veda-mail-move";

interface MoveIntent {
  readonly ids: readonly MessageId[];
  readonly label: string;
  readonly sourceMailboxId: MailboxId;
}

interface DragIntent extends MoveIntent {
  readonly sessionScope: string;
  readonly token: string;
  readonly viewKey: string;
}

interface Options {
  readonly activeMailboxId: MailboxId | null;
  readonly isBusy: boolean;
  readonly mailboxes: readonly Mailbox[];
  readonly messages: readonly MessageSummary[];
  readonly mutateIds: (
    action: BulkMessageAction,
    messageIds: readonly MessageId[],
  ) => Promise<void>;
  readonly selectedIds: ReadonlySet<MessageId>;
  readonly sessionScope: string;
  readonly viewKey: string;
}

const hasInternalType = (
  event: React.DragEvent<HTMLElement>,
): boolean =>
  event.dataTransfer.types.includes(VEDA_MESSAGE_DRAG_TYPE);

export const useMessageMoveInteractions = ({
  activeMailboxId,
  isBusy,
  mailboxes,
  messages,
  mutateIds,
  selectedIds,
  sessionScope,
  viewKey,
}: Options) => {
  const [announcement, setAnnouncement] = useState("");
  const [dialog, setDialog] = useState<MoveIntent | null>(null);
  const [dragSnapshot, setDragSnapshot] = useState<DragIntent | null>(null);
  const [dropTargetId, setDropTargetId] = useState<MailboxId | null>(null);
  const dragRef = useRef<DragIntent | null>(null);
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const targets = useMemo(
    () => messageMoveTargets(mailboxes, activeMailboxId),
    [activeMailboxId, mailboxes],
  );
  const targetById = useMemo(
    () => new Map(targets.map((target) => [target.id, target])),
    [targets],
  );
  const loadedIds = useMemo(
    () => new Set(messages.map(({ id }) => id)),
    [messages],
  );

  const clearDrag = useCallback((nextAnnouncement = "") => {
    dragRef.current = null;
    setDragSnapshot(null);
    setDropTargetId(null);
    setAnnouncement(nextAnnouncement);
  }, []);

  const closeDialog = useCallback(() => {
    setDialog(null);
    const trigger = dialogTrigger.current;
    dialogTrigger.current = null;
    globalThis.requestAnimationFrame?.(() => trigger?.focus());
  }, []);

  useEffect(() => {
    clearDrag();
    setDialog(null);
    dialogTrigger.current = null;
  }, [clearDrag, sessionScope, viewKey]);

  const requestMove = useCallback((
    messageId: MessageId,
    label: string,
    trigger: HTMLButtonElement,
    includeSelection: boolean,
  ) => {
    if (
      !activeMailboxId ||
      isBusy ||
      (includeSelection && !loadedIds.has(messageId)) ||
      !targets.length
    ) {
      return;
    }
    const ids = includeSelection
      ? resolveDraggedMessageIds(messageId, selectedIds)
      : [messageId];
    dialogTrigger.current = trigger;
    setDialog({ ids, label, sourceMailboxId: activeMailboxId });
  }, [activeMailboxId, isBusy, loadedIds, selectedIds, targets.length]);

  const confirmMove = useCallback((destinationMailboxId: string) => {
    const target = targetById.get(destinationMailboxId as MailboxId);
    const intent = dialog;
    if (!target || !intent || isBusy || intent.sourceMailboxId !== activeMailboxId) {
      return;
    }
    closeDialog();
    void mutateIds({
      destinationMailboxId: target.id,
      sourceMailboxId: intent.sourceMailboxId,
      type: "move",
    }, intent.ids);
  }, [activeMailboxId, closeDialog, dialog, isBusy, mutateIds, targetById]);

  const row = useCallback((messageId: MessageId, label: string, canMove: boolean) => ({
    canDrag: canMove && !isBusy && targets.length > 0,
    onDragEnd: () => {
      if (dragRef.current) clearDrag("Move canceled.");
    },
    onDragStart: (event: React.DragEvent<HTMLElement>) => {
      if (!canMove || isBusy || !activeMailboxId || !loadedIds.has(messageId)) {
        event.preventDefault();
        return;
      }
      const ids = resolveDraggedMessageIds(messageId, selectedIds)
        .filter((candidate) => loadedIds.has(candidate));
      if (!ids.length || !targets.length) {
        event.preventDefault();
        return;
      }
      const intent: DragIntent = {
        ids,
        label,
        sessionScope,
        sourceMailboxId: activeMailboxId,
        token: crypto.randomUUID(),
        viewKey,
      };
      dragRef.current = intent;
      setDragSnapshot(intent);
      setAnnouncement(
        `Dragging ${ids.length} ${ids.length === 1 ? "message" : "messages"}. Choose an highlighted mailbox to move.`,
      );
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(VEDA_MESSAGE_DRAG_TYPE, intent.token);
    },
    onRequestMove: (event: React.MouseEvent<HTMLButtonElement>) =>
      requestMove(messageId, label, event.currentTarget, true),
  }), [activeMailboxId, clearDrag, isBusy, loadedIds, requestMove,
    selectedIds, sessionScope, targets.length, viewKey]);

  const folder = useCallback((mailboxId: MailboxId) => {
    const target = targetById.get(mailboxId);
    const accepts = Boolean(target && dragSnapshot && !isBusy);
    const acceptsEvent = (event: React.DragEvent<HTMLElement>) =>
      accepts && hasInternalType(event);
    return {
      canDrop: accepts,
      isDropTarget: accepts && dropTargetId === mailboxId,
      onDragEnter: (event: React.DragEvent<HTMLElement>) => {
        if (!acceptsEvent(event)) return;
        event.preventDefault();
        setDropTargetId(mailboxId);
      },
      onDragLeave: (event: React.DragEvent<HTMLElement>) => {
        const related = event.relatedTarget;
        if (related instanceof Node && event.currentTarget.contains(related)) return;
        if (dropTargetId === mailboxId) setDropTargetId(null);
      },
      onDragOver: (event: React.DragEvent<HTMLElement>) => {
        if (!acceptsEvent(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      },
      onDrop: (event: React.DragEvent<HTMLElement>) => {
        const intent = dragRef.current;
        if (
          !target ||
          !acceptsEvent(event) ||
          !intent ||
          event.dataTransfer.getData(VEDA_MESSAGE_DRAG_TYPE) !== intent.token
        ) return;
        event.preventDefault();
        const current = intent.sessionScope === sessionScope &&
          intent.viewKey === viewKey &&
          intent.sourceMailboxId === activeMailboxId &&
          intent.ids.every((messageId) => loadedIds.has(messageId));
        clearDrag();
        if (!current) return;
        void mutateIds({
          destinationMailboxId: target.id,
          sourceMailboxId: intent.sourceMailboxId,
          type: "move",
        }, intent.ids);
      },
    };
  }, [activeMailboxId, clearDrag, dragSnapshot, dropTargetId, isBusy,
    loadedIds, mutateIds, sessionScope, targetById, viewKey]);

  return {
    announcement,
    dialog: {
      count: dialog?.ids.length ?? 0,
      isOpen: Boolean(dialog),
      label: dialog?.label ?? "",
      onCancel: closeDialog,
      onMove: confirmMove,
      targets,
    },
    folder,
    requestReaderMove: (messageId: MessageId, label: string, trigger: HTMLButtonElement) =>
      requestMove(messageId, label, trigger, false),
    row,
  };
};
