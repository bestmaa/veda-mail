"use client";

import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $getRoot,
  type EditorThemeClasses,
  type LexicalEditor,
} from "lexical";
import { useEffect, useMemo } from "react";

import { ComposerPlainTransferConnector } from "@/presentation/features/mail-workspace/connectors/composer-plain-transfer.connector";
import { useComposerEditorToolbar } from "@/presentation/features/mail-workspace/hooks/use-composer-editor-toolbar";
import type { RichComposerSnapshot } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import { ComposerFormattingToolbarView } from "@/presentation/features/mail-workspace/ui/composer-formatting-toolbar.view";
import { ComposerLinkEditorView } from "@/presentation/features/mail-workspace/ui/composer-link-editor.view";

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

const EditorStateBridge = ({
  disabled,
  onChange,
}: {
  readonly disabled: boolean;
  readonly onChange: (snapshot: RichComposerSnapshot) => void;
}) => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(!disabled), [disabled, editor]);
  return (
    <OnChangePlugin
      ignoreSelectionChange
      onChange={(editorState) => {
        editorState.read(() =>
          onChange({
            html: $generateHtmlFromNodes(editor),
            text: $getRoot().getTextContent(),
          }),
        );
      }}
    />
  );
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
  disabled,
  initialHtml,
  onChange,
}: {
  readonly autoFocus: boolean;
  readonly disabled: boolean;
  readonly initialHtml: string;
  readonly onChange: (snapshot: RichComposerSnapshot) => void;
}) => {
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
      },
      editable: !disabled,
      namespace: "VedaMailComposer",
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode],
      onError: (error: Error) => {
        throw error;
      },
      theme,
    }),
    [disabled, initialHtml],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <FormattingConnector disabled={disabled} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-disabled={disabled}
              aria-label="Message body"
              aria-multiline="true"
              aria-required="true"
              className="composer-rich-editor h-full min-h-0 overflow-y-auto px-4 py-4 text-sm leading-6 text-slate-700 outline-none focus-visible:outline-2 focus-visible:outline-indigo-600"
              spellCheck
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
          placeholder={
            <span className="pointer-events-none absolute left-4 top-4 text-sm text-slate-500">
              Write a clear message…
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
      <EditorStateBridge disabled={disabled} onChange={onChange} />
      {autoFocus ? <AutoFocusPlugin defaultSelection="rootStart" /> : null}
    </LexicalComposer>
  );
};
