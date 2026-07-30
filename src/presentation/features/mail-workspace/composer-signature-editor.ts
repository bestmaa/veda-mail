"use client";

import { $generateNodesFromDOM } from "@lexical/html";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $nodesOfType,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from "lexical";

import type { EmailSignature } from "@/domain/member/email-signature";
import { plainTextToComposerHtml } from "@/presentation/features/mail-workspace/composer-body-content";
import {
  $createEmailSignatureNode,
  EmailSignatureNode,
} from "@/presentation/features/mail-workspace/composer-signature.node";

export type ComposerSignatureOption = Pick<
  EmailSignature,
  "body" | "htmlBody" | "id" | "name"
>;
export type ComposerSignatureInitialContentPlacement = "prefix" | "tail";
export interface ComposerSignatureSlotState {
  readonly id: string | null;
  readonly isPresent: boolean;
  readonly nextKey: NodeKey | null;
  readonly previousKey: NodeKey | null;
}

const signatureHtml = (signature: ComposerSignatureOption): string =>
  signature.htmlBody ?? plainTextToComposerHtml(signature.body);

const signatureChildren = (
  editor: LexicalEditor,
  signature: ComposerSignatureOption,
): readonly LexicalNode[] => {
  const parsed = new DOMParser().parseFromString(
    signatureHtml(signature),
    "text/html",
  );
  const nodes = $generateNodesFromDOM(editor, parsed);
  if (nodes.length > 0) return nodes;
  return [$createParagraphNode()];
};

export const $placeComposerSignature = (
  signatureNode: EmailSignatureNode,
): void => {
  const [first, ...duplicates] = $nodesOfType(EmailSignatureNode);
  for (const duplicate of duplicates) duplicate.remove();
  if (first) {
    first.replace(signatureNode);
    return;
  }
  $getRoot().append(signatureNode);
};

export const $composerSignatureId = (): string | null =>
  $nodesOfType(EmailSignatureNode)[0]?.getSignatureId() ?? null;

export const $composerSignatureSlotState =
  (): ComposerSignatureSlotState => {
    const slot = $nodesOfType(EmailSignatureNode)[0];
    return {
      id: slot?.getSignatureId() ?? null,
      isPresent: Boolean(slot),
      nextKey: slot?.getNextSibling()?.getKey() ?? null,
      previousKey: slot?.getPreviousSibling()?.getKey() ?? null,
    };
  };

export const $restoreComposerSignatureSlot = (
  boundary: Pick<ComposerSignatureSlotState, "nextKey" | "previousKey">,
): void => {
  if ($nodesOfType(EmailSignatureNode).length > 0) return;
  const root = $getRoot();
  const slot = $createEmailSignatureNode(null);
  const next = boundary.nextKey ? $getNodeByKey(boundary.nextKey) : null;
  if (next?.getParent()?.is(root)) {
    next.insertBefore(slot);
    return;
  }
  const previous = boundary.previousKey
    ? $getNodeByKey(boundary.previousKey)
    : null;
  if (previous?.getParent()?.is(root)) {
    previous.insertAfter(slot);
    return;
  }
  root.append(slot);
};

export const $initializeComposerSignatureSlot = (
  placement: ComposerSignatureInitialContentPlacement,
): void => {
  const root = $getRoot();
  const [slot] = $nodesOfType(EmailSignatureNode);
  $deduplicateComposerSignatures();
  if (slot) return;

  const newSlot = $createEmailSignatureNode(null);
  if (placement === "tail") {
    root.splice(0, 0, [$createParagraphNode(), newSlot]);
    return;
  }
  root.append(newSlot);
};

export const $deduplicateComposerSignatures = (): void => {
  const [, ...duplicates] = $nodesOfType(EmailSignatureNode);
  for (const duplicate of duplicates) duplicate.remove();
};

export const $removeComposerSignature = (): void => {
  const [slot, ...duplicates] = $nodesOfType(EmailSignatureNode);
  for (const duplicate of duplicates) duplicate.remove();
  if (slot) {
    slot.clear();
    slot.setSignatureId(null);
  } else {
    $getRoot().append($createEmailSignatureNode(null));
  }
};

export const $replaceComposerSignature = (
  editor: LexicalEditor,
  signature: ComposerSignatureOption | null,
): void => {
  if (!signature) {
    $removeComposerSignature();
    return;
  }

  const [slot, ...duplicates] = $nodesOfType(EmailSignatureNode);
  for (const duplicate of duplicates) duplicate.remove();
  const target = slot ?? $createEmailSignatureNode(null);
  target.clear();
  target.setSignatureId(signature.id);
  target.append(...signatureChildren(editor, signature));
  if (!slot) $getRoot().append(target);
};
