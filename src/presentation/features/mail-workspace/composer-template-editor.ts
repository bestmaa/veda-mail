"use client";

import { $generateNodesFromDOM } from "@lexical/html";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

import { plainTextToComposerHtml } from "@/presentation/features/mail-workspace/composer-body-content";
import {
  $deduplicateComposerSignatures,
} from "@/presentation/features/mail-workspace/composer-signature-editor";
import {
  $isEmailSignatureNode,
  EmailSignatureNode,
} from "@/presentation/features/mail-workspace/composer-signature.node";

export interface ComposerTemplateApplication {
  readonly action: "insert" | "replace";
  readonly body: string;
  readonly htmlBody?: string;
  readonly nonce: number;
}

const templateNodes = (
  editor: LexicalEditor,
  application: ComposerTemplateApplication,
): readonly LexicalNode[] => {
  const document = new DOMParser().parseFromString(
    application.htmlBody ?? plainTextToComposerHtml(application.body),
    "text/html",
  );
  const nodes = $generateNodesFromDOM(editor, document);
  return nodes.length > 0 ? nodes : [$createParagraphNode()];
};

const selectionTouchesSignature = (): boolean => {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  return [
    selection.anchor.getNode(),
    selection.focus.getNode(),
    ...selection.getNodes(),
  ].some((node) => [node, ...node.getParents()].some($isEmailSignatureNode));
};

const insertBeforeSignature = (nodes: readonly LexicalNode[]): void => {
  const signature = $getRoot().getChildren().find(
    (node) => node instanceof EmailSignatureNode,
  );
  if (signature) {
    for (const node of nodes) signature.insertBefore(node);
    return;
  }
  $getRoot().append(...nodes);
};

export const $applyComposerTemplate = (
  editor: LexicalEditor,
  application: ComposerTemplateApplication,
): void => {
  const nodes = templateNodes(editor, application);
  $applyComposerTemplateNodes(application.action, nodes);
};

export const $applyComposerTemplateNodes = (
  action: ComposerTemplateApplication["action"],
  nodes: readonly LexicalNode[],
): void => {
  $deduplicateComposerSignatures();
  const root = $getRoot();
  const signature = root.getChildren().find(
    (node) => node instanceof EmailSignatureNode,
  );

  if (action === "replace") {
    for (const node of root.getChildren()) {
      if (node !== signature) node.remove();
    }
    insertBeforeSignature(nodes);
  } else {
    const selection = $getSelection();
    if ($isRangeSelection(selection) && !selectionTouchesSignature()) {
      selection.insertNodes([...nodes]);
    } else {
      insertBeforeSignature(nodes);
    }
  }

  if (root.isEmpty()) root.append($createParagraphNode());
  $deduplicateComposerSignatures();
};

export const applyPlainComposerTemplate = (
  current: string,
  application: ComposerTemplateApplication,
  selectionStart: number,
  selectionEnd: number,
): { readonly caret: number; readonly text: string } => {
  if (application.action === "replace") {
    return { caret: application.body.length, text: application.body };
  }
  const start = Math.max(0, Math.min(selectionStart, current.length));
  const end = Math.max(start, Math.min(selectionEnd, current.length));
  const text = `${current.slice(0, start)}${application.body}${current.slice(end)}`;
  return { caret: start + application.body.length, text };
};
