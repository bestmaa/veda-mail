import { FileText, TextCursorInput } from "lucide-react";

import { ComposerRichTextEditorConnector } from "@/presentation/features/mail-workspace/connectors/composer-rich-text-editor.connector";
import type { ComposerBodyViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

export const ComposerBodyView = ({
  body,
  focusBody,
  isReadOnly = false,
  isSending,
}: {
  readonly body: ComposerBodyViewModel;
  readonly focusBody: boolean;
  readonly isReadOnly?: boolean;
  readonly isSending: boolean;
}) => (
  <div className="flex min-h-56 flex-1 flex-col">
      <div className="flex min-h-11 items-center gap-2 border-b border-slate-100 px-3">
        {body.signatureDetached ? (
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-500">
            Signature is now editable message text
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <button
          aria-label={
            body.mode === "rich"
              ? "Switch to plain text"
              : "Switch to rich text"
          }
          className="flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-bold text-slate-600 hover:bg-indigo-50 hover:text-indigo-800 focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50"
          disabled={isSending || isReadOnly}
          id="composer-body-mode-toggle"
          onClick={body.onToggleMode}
          type="button"
        >
          {body.mode === "rich" ? (
            <FileText aria-hidden size={16} />
          ) : (
            <TextCursorInput aria-hidden size={16} />
          )}
          {body.mode === "rich" ? "Plain text" : "Rich text"}
        </button>
      </div>
      {body.isPlainModeWarningOpen ? (
        <div
          aria-describedby="composer-formatting-loss-description"
          aria-labelledby="composer-formatting-loss-title"
          className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950"
          onKeyDown={body.onWarningKeyDown}
          role="alertdialog"
        >
          <p className="font-semibold" id="composer-formatting-loss-title">
            Remove message formatting?
          </p>
          <p id="composer-formatting-loss-description">
            Switching to plain text will remove headings, lists, links, and
            text styling.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              className="h-9 rounded-lg bg-amber-900 px-3 font-bold text-white"
              disabled={isSending || isReadOnly}
              id="composer-formatting-loss-confirm"
              onClick={body.confirmPlainMode}
              type="button"
            >
              Switch to plain text
            </button>
            <button
              className="h-9 rounded-lg px-3 font-bold hover:bg-amber-100"
              disabled={isSending || isReadOnly}
              id="composer-formatting-loss-cancel"
              onClick={body.cancelPlainMode}
              type="button"
            >
              Keep formatting
            </button>
          </div>
        </div>
      ) : null}
      {body.mode === "plain" ? (
        <textarea
          aria-label="Message body"
          autoFocus={focusBody}
          className="min-h-0 flex-1 resize-none px-4 py-4 text-sm leading-6 text-slate-700 outline-none placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-indigo-600"
          disabled={isSending}
          id="composer-message-body"
          onChange={body.onPlainInput}
          onDrop={body.onPlainDrop}
          onPaste={body.onPlainPaste}
          placeholder="Write a clear message…"
          readOnly={isReadOnly}
          required
          value={body.text}
        />
      ) : (
        <ComposerRichTextEditorConnector
          autoFocus={focusBody}
          disabled={isSending}
          initialHtml={body.html}
          readOnly={isReadOnly}
          key={body.editorVersion}
          onChange={body.onRichChange}
          onInitialize={body.onRichInitialize}
          {...(body.signature ? { signature: body.signature } : {})}
        />
      )}
      {body.mode === "plain" ? (
        <span aria-live="polite" className="sr-only" role="status">
          {body.plainTransferStatus}
        </span>
      ) : null}
      <span aria-live="polite" className="sr-only" role="status">
        {body.signatureAnnouncement}
      </span>
    </div>
);
