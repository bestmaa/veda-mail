"use client";

import { $generateNodesFromDOM } from "@lexical/html";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $getRoot,
  type EditorThemeClasses,
  type LexicalEditor,
} from "lexical";
import { useMemo } from "react";

import { ComposerEditorStateBridgeConnector } from "@/presentation/features/mail-workspace/connectors/composer-editor-state-bridge.connector";
import { ComposerPlainTransferConnector } from "@/presentation/features/mail-workspace/connectors/composer-plain-transfer.connector";
import { ComposerSignatureControlsConnector } from "@/presentation/features/mail-workspace/connectors/composer-signature-controls.connector";
import { ComposerTemplateConnector } from "@/presentation/features/mail-workspace/connectors/composer-template.connector";
import type { ComposerSignatureEditorConfiguration } from "@/presentation/features/mail-workspace/composer-signature-picker.view-model";
import { $initializeComposerSignatureSlot } from "@/presentation/features/mail-workspace/composer-signature-editor";
import { EmailSignatureNode } from "@/presentation/features/mail-workspace/composer-signature.node";
import { useComposerEditorToolbar } from "@/presentation/features/mail-workspace/hooks/use-composer-editor-toolbar";
import type { RichComposerSnapshot } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import { ComposerFormattingToolbarView } from "@/presentation/features/mail-workspace/ui/composer-formatting-toolbar.view";
import { ComposerLinkEditorView } from "@/presentation/features/mail-workspace/ui/composer-link-editor.view";
import type { ComposerTemplateApplication } from "@/presentation/features/mail-workspace/composer-template-editor";

const theme: EditorThemeClasses = {
  heading: {
    h1: "composer-editor-h1",
    h2: "composer-editor-h2",
  },
  link: "composer-editor-link",
  list: {
    listitem: "composer-editor-list-item",
    nested: { listitem: "composer-editor-nested-list-item" },
    ol: "composer-editor-ol",
    ul: "composer-editor-ul",
  },
  paragraph: "composer-editor-paragraph",
  quote: "composer-editor-quote",
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
  },
};

const FormattingConnector = ({ disabled }: { readonly disabled: boolean }) => {
  const toolbar = useComposerEditorToolbar(disabled);
  return (
    <>
      <ComposerFormattingToolbarView
        blockType={toolbar.blockType}
        canRedo={toolbar.canRedo}
        canUndo={toolbar.canUndo}
        disabled={disabled}
        isBold={toolbar.isBold}
        isItalic={toolbar.isItalic}
        isLink={toolbar.isLink}
        isUnderline={toolbar.isUnderline}
        onBlockTypeChange={toolbar.onBlockTypeChange}
        onBold={toolbar.onBold}
        onClear={toolbar.onClear}
        onItalic={toolbar.onItalic}
        onLink={toolbar.onLink}
        onOrderedList={toolbar.onOrderedList}
        onRedo={toolbar.onRedo}
        onToolbarKeyDown={toolbar.onToolbarKeyDown}
        onUnderline={toolbar.onUnderline}
        onUndo={toolbar.onUndo}
        onUnorderedList={toolbar.onUnorderedList}
        preserveSelection={toolbar.preserveSelection}
        toolbarRef={toolbar.toolbarRef}
      />
      {toolbar.isLinkEditorOpen ? (
        <ComposerLinkEditorView
          disabled={disabled}
          error={toolbar.linkError}
          inputRef={toolbar.linkInputRef}
          onApply={toolbar.onApplyLink}
          onCancel={toolbar.closeLinkEditor}
          onInput={toolbar.onLinkInput}
          onKeyDown={toolbar.onLinkKeyDown}
          onRemove={toolbar.onRemoveLink}
          value={toolbar.linkValue}
        />
      ) : null}
      <span aria-live="polite" className="sr-only" role="status">
        {toolbar.statusMessage}
      </span>
    </>
  );
};

export const ComposerRichTextEditorConnector = ({
  autoFocus,
  application = null,
  disabled,
  initialHtml,
  label = "Message body",
  namespace = "VedaMailComposer",
  onChange,
  onInitialize,
  onTemplateApplied = () => undefined,
  placeholder = "Write a clear message…",
  readOnly = false,
  required = true,
  signature,
}: {
  readonly autoFocus: boolean;
  readonly application?: ComposerTemplateApplication | null;
  readonly disabled: boolean;
  readonly initialHtml: string;
  readonly label?: string;
  readonly namespace?: string;
  readonly onChange: (snapshot: RichComposerSnapshot) => void;
  readonly onInitialize?: (snapshot: RichComposerSnapshot) => void;
  readonly onTemplateApplied?: (nonce: number) => void;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
  readonly required?: boolean;
  readonly signature?: ComposerSignatureEditorConfiguration;
}) => {
  const signaturePlacement = signature?.initialContentPlacement;
  const initialConfig = useMemo(
    () => ({
      editorState: (editor: LexicalEditor) => {
        const root = $getRoot();
        if (initialHtml && typeof DOMParser !== "undefined") {
          const document = new DOMParser().parseFromString(
            initialHtml,
            "text/html",
          );
          root.append(...$generateNodesFromDOM(editor, document));
        }
        if (root.isEmpty()) root.append($createParagraphNode());
        if (signaturePlacement) {
          $initializeComposerSignatureSlot(signaturePlacement);
        }
      },
      editable: !disabled && !readOnly,
      namespace,
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        LinkNode,
        EmailSignatureNode,
      ],
      onError: (error: Error) => {
        throw error;
      },
      theme,
    }),
    [disabled, initialHtml, namespace, readOnly, signaturePlacement],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <FormattingConnector disabled={disabled || readOnly} />
      {signature ? (
        <ComposerSignatureControlsConnector
          configuration={signature}
          disabled={disabled || readOnly}
        />
      ) : null}
      <ComposerTemplateConnector
        application={application}
        disabled={disabled || readOnly}
        onApplied={onTemplateApplied}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-disabled={disabled}
              aria-label={label}
              aria-multiline="true"
              aria-readonly={readOnly}
              aria-required={required}
              className="composer-rich-editor h-full min-h-0 overflow-y-auto px-4 py-4 text-sm leading-6 text-slate-700 outline-none focus-visible:outline-2 focus-visible:outline-indigo-600"
              spellCheck
              tabIndex={readOnly ? 0 : undefined}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
          placeholder={
            <span className="pointer-events-none absolute left-4 top-4 text-sm text-slate-500">
              {placeholder}
            </span>
          }
        />
      </div>
      <HistoryPlugin />
      <ListPlugin hasStrictIndent />
      <LinkPlugin
        attributes={{ rel: "noopener noreferrer", target: "_blank" }}
      />
      <ComposerPlainTransferConnector />
      <ComposerEditorStateBridgeConnector
        disabled={disabled || readOnly}
        onChange={onChange}
        {...(onInitialize ? { onInitialize } : {})}
      />
      {autoFocus ? <AutoFocusPlugin defaultSelection="rootStart" /> : null}
    </LexicalComposer>
  );
};
