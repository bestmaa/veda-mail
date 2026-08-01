import {
  Archive,
  FolderInput,
  Tag,
  Mail,
  MailOpen,
  RotateCcw,
  ShieldAlert,
  Star,
  Trash2,
  X,
} from "lucide-react";

import type { BulkActionsViewModel } from "@/presentation/features/mail-workspace/bulk-actions.view-model";

const actionClass =
  "grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-50";

const ActionButton = ({
  label,
  onClick,
  children,
  disabled,
}: {
  readonly children: React.ReactNode;
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) => (
  <button
    aria-label={label}
    className={actionClass}
    disabled={disabled}
    onClick={onClick}
    title={label}
    type="button"
  >
    {children}
  </button>
);

export const BulkActionsToolbarView = ({
  bulk,
}: {
  readonly bulk: BulkActionsViewModel;
}) => {
  if (bulk.selectedCount === 0) return null;
  return (
    <div
      aria-busy={bulk.isBusy}
      aria-label="Bulk message actions"
      className="mt-3 flex items-center gap-2 overflow-x-auto rounded-2xl border border-indigo-100 bg-indigo-50/70 p-2"
      role="toolbar"
    >
      <ActionButton
        disabled={bulk.isBusy}
        label="Clear message selection"
        onClick={bulk.onClear}
      >
        <X aria-hidden size={18} />
      </ActionButton>
      <span className="shrink-0 px-1 text-xs font-bold text-indigo-900">
        {bulk.selectedCount} selected
      </span>
      <ActionButton
        disabled={bulk.isBusy}
        label="Mark selected messages as read"
        onClick={bulk.onMarkRead}
      >
        <MailOpen aria-hidden size={18} />
      </ActionButton>
      <ActionButton
        disabled={bulk.isBusy}
        label="Mark selected messages as unread"
        onClick={bulk.onMarkUnread}
      >
        <Mail aria-hidden size={18} />
      </ActionButton>
      <ActionButton
        disabled={bulk.isBusy}
        label="Star selected messages"
        onClick={bulk.onStar}
      >
        <Star aria-hidden size={18} />
      </ActionButton>
      <ActionButton
        disabled={bulk.isBusy}
        label="Remove star from selected messages"
        onClick={bulk.onUnstar}
      >
        <Star aria-hidden className="fill-slate-300" size={18} />
      </ActionButton>
      {bulk.canArchive ? (
        <ActionButton
          disabled={bulk.isBusy}
          label="Archive selected messages"
          onClick={bulk.onArchive}
        >
          <Archive aria-hidden size={18} />
        </ActionButton>
      ) : null}
      {bulk.canSpam ? (
        <ActionButton
          disabled={bulk.isBusy}
          label={bulk.spamLabel}
          onClick={bulk.onSpam}
        >
          <ShieldAlert aria-hidden size={18} />
        </ActionButton>
      ) : null}
      {bulk.canTrash ? (
        <ActionButton
          disabled={bulk.isBusy}
          label="Move selected messages to trash"
          onClick={bulk.onTrash}
        >
          <Trash2 aria-hidden size={18} />
        </ActionButton>
      ) : null}
      {bulk.canRestore ? (
        <ActionButton
          disabled={bulk.isBusy}
          label={bulk.restoreLabel}
          onClick={bulk.onRestore}
        >
          <RotateCcw aria-hidden size={18} />
        </ActionButton>
      ) : null}
      {bulk.canDestroy ? (
        <ActionButton
          disabled={bulk.isBusy}
          label="Permanently delete selected messages"
          onClick={bulk.onRequestDestroy}
        >
          <Trash2 aria-hidden className="text-red-600" size={18} />
        </ActionButton>
      ) : null}
      {bulk.moveTargets.length ? (
        <label className="relative shrink-0">
          <span className="sr-only">Move selected messages</span>
          <FolderInput
            aria-hidden
            className="pointer-events-none absolute left-3 top-3 text-slate-600"
            size={16}
          />
          <select
            aria-label="Move selected messages"
            className="h-10 max-w-44 rounded-xl border border-slate-200 bg-white pl-9 pr-7 text-xs font-bold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-50"
            defaultValue=""
            disabled={bulk.isBusy}
            onChange={(event) => {
              if (event.currentTarget.value) {
                bulk.onMove(event.currentTarget.value);
                event.currentTarget.value = "";
              }
            }}
          >
            <option disabled value="">
              Move to…
            </option>
            {bulk.moveTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {bulk.labels.length ? ([
        ["Apply label…", bulk.onApplyLabel],
        ["Remove label…", bulk.onRemoveLabel],
      ] as const).map(([placeholder, onChange]) => (
        <label className="relative shrink-0" key={placeholder}>
          <span className="sr-only">{placeholder}</span>
          <Tag aria-hidden className="pointer-events-none absolute left-3 top-3" size={16} />
          <select
            aria-label={placeholder}
            className="h-10 max-w-44 rounded-xl border border-slate-200 bg-white pl-9 pr-7 text-xs font-bold"
            defaultValue=""
            disabled={bulk.isBusy}
            onChange={(event) => {
              if (event.currentTarget.value) onChange(event.currentTarget.value);
              event.currentTarget.value = "";
            }}
          >
            <option disabled value="">{placeholder}</option>
            {bulk.labels.map((label) => (
              <option key={label.id} value={label.id}>{label.name}</option>
            ))}
          </select>
        </label>
      )) : null}
    </div>
  );
};
