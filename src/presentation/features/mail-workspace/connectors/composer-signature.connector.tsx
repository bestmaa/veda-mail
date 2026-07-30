"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useRef } from "react";

import { id, type SignatureId } from "@/domain/shared/brand";
import {
  $composerSignatureSlotState,
  $deduplicateComposerSignatures,
  $replaceComposerSignature,
  $restoreComposerSignatureSlot,
  type ComposerSignatureSlotState,
  type ComposerSignatureOption,
} from "@/presentation/features/mail-workspace/composer-signature-editor";
import { EmailSignatureNode } from "@/presentation/features/mail-workspace/composer-signature.node";
import { clearAttachedComposerSignatureSelection } from "@/presentation/features/mail-workspace/composer-signature-selection";

export const ComposerSignatureConnector = ({
  clearSelectionOnUnmount = true,
  onSelectedIdChange,
  selected,
}: {
  readonly clearSelectionOnUnmount?: boolean;
  readonly onSelectedIdChange: (signatureId: SignatureId | null) => void;
  readonly selected: ComposerSignatureOption | null;
}) => {
  const [editor] = useLexicalComposerContext();
  const appliedId = useRef<string | null | undefined>(undefined);
  const boundary = useRef<
    Pick<ComposerSignatureSlotState, "nextKey" | "previousKey">
  >({ nextKey: null, previousKey: null });
  const observedId = useRef<string | null | undefined>(undefined);
  const onSelectedIdChangeRef = useRef(onSelectedIdChange);
  const selectedId = selected?.id ?? null;

  useEffect(() => {
    onSelectedIdChangeRef.current = onSelectedIdChange;
  }, [onSelectedIdChange]);

  useEffect(() => {
    if (appliedId.current === selectedId) return;
    appliedId.current = selectedId;
    editor.update(
      () => $replaceComposerSignature(editor, selected),
      { discrete: true },
    );
  }, [editor, selected, selectedId]);

  useEffect(() => {
    const removeTransform = editor.registerNodeTransform(
      EmailSignatureNode,
      $deduplicateComposerSignatures,
    );
    const removeListener = editor.registerUpdateListener(({ editorState }) => {
      const slot = editorState.read($composerSignatureSlotState);
      if (!slot.isPresent) {
        appliedId.current = null;
        if (observedId.current !== null) {
          observedId.current = null;
          onSelectedIdChangeRef.current(null);
        }
        editor.update(
          () => $restoreComposerSignatureSlot(boundary.current),
          { discrete: true },
        );
        return;
      }
      boundary.current = {
        nextKey: slot.nextKey,
        previousKey: slot.previousKey,
      };
      if (observedId.current === slot.id) return;
      observedId.current = slot.id;
      appliedId.current = slot.id;
      onSelectedIdChangeRef.current(
        slot.id === null ? null : id.signature(slot.id),
      );
    });
    const initialSlot = editor.getEditorState().read(
      $composerSignatureSlotState,
    );
    boundary.current = {
      nextKey: initialSlot.nextKey,
      previousKey: initialSlot.previousKey,
    };
    return () => {
      removeListener();
      removeTransform();
    };
  }, [editor]);

  useEffect(
    () => () => {
      if (clearSelectionOnUnmount) {
        clearAttachedComposerSignatureSelection(
          appliedId.current,
          onSelectedIdChangeRef.current,
        );
      }
    },
    [clearSelectionOnUnmount],
  );

  return null;
};
