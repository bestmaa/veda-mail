import { FolderInput } from "lucide-react";

import type { MailWorkspaceViewProps } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

type MoveDialog = MailWorkspaceViewProps["messageMove"]["dialog"];

export const MessageMoveDialogView = ({ dialog }: { readonly dialog: MoveDialog }) =>
  dialog.isOpen ? (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 p-4">
      <div
        aria-describedby="message-move-description"
        aria-labelledby="message-move-title"
        aria-modal="true"
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
        id="message-move-dialog"
        role="dialog"
        tabIndex={-1}
      >
        <h2 className="text-xl font-extrabold text-slate-900" id="message-move-title">
          Move {dialog.count === 1 ? dialog.label : `${dialog.count} messages`}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600" id="message-move-description">
          Choose a destination. This is the complete keyboard and touch alternative to drag and drop.
        </p>
        <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
          {dialog.targets.map((target, index) => (
            <button
              className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-slate-200 px-3 text-left text-sm font-bold text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              id={`message-move-target-${index}`}
              key={target.id}
              onClick={() => dialog.onMove(target.id)}
              type="button"
            >
              <FolderInput aria-hidden className="shrink-0 text-indigo-600" size={17} />
              <span className="min-w-0 flex-1 truncate">{target.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-6 flex justify-end">
          <button
            className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            id="message-move-cancel"
            onClick={dialog.onCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  ) : null;
