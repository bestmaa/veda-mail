import {
  Bold,
  Italic,
  Link,
  List,
  ListOrdered,
  Redo2,
  RemoveFormatting,
  Underline,
  Undo2,
} from "lucide-react";

import type { ComposerFormattingToolbarProps } from "@/presentation/features/mail-workspace/composer-rich-text.view-model";

const buttonClass =
  "grid size-11 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-indigo-50 hover:text-indigo-800 focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-35";

const ToggleButton = ({
  active,
  disabled,
  label,
  onClick,
  onMouseDown,
  shortcut,
  children,
}: {
  readonly active?: boolean;
  readonly children: React.ReactNode;
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly onMouseDown: ComposerFormattingToolbarProps["preserveSelection"];
  readonly shortcut?: string;
}) => (
  <button
    aria-keyshortcuts={shortcut}
    aria-label={label}
    aria-pressed={active}
    className={`${buttonClass} ${active ? "bg-indigo-100 text-indigo-900" : ""}`}
    disabled={disabled}
    onClick={onClick}
    onMouseDown={onMouseDown}
    tabIndex={-1}
    title={label}
    type="button"
  >
    {children}
  </button>
);

export const ComposerFormattingToolbarView = ({
  blockType,
  canRedo,
  canUndo,
  disabled,
  isBold,
  isItalic,
  isLink,
  isUnderline,
  onBlockTypeChange,
  onBold,
  onClear,
  onItalic,
  onLink,
  onOrderedList,
  onRedo,
  onToolbarKeyDown,
  onUnderline,
  onUndo,
  onUnorderedList,
  preserveSelection,
  toolbarRef,
}: ComposerFormattingToolbarProps) => (
  <div
    aria-label="Formatting options"
    className="flex min-h-12 items-center gap-0.5 overflow-x-auto border-b border-slate-100 px-2"
    onKeyDown={onToolbarKeyDown}
    ref={toolbarRef}
    role="toolbar"
  >
    <select
      aria-label="Text style"
      className="h-10 shrink-0 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-indigo-600"
      disabled={disabled}
      onChange={onBlockTypeChange}
      tabIndex={0}
      value={blockType === "bullet" || blockType === "number" ? "p" : blockType}
    >
      <option value="p">Paragraph</option>
      <option value="h1">Heading 1</option>
      <option value="h2">Heading 2</option>
    </select>
    <ToggleButton
      active={isBold}
      disabled={disabled}
      label="Bold"
      onClick={onBold}
      onMouseDown={preserveSelection}
      shortcut="Control+B Meta+B"
    >
      <Bold aria-hidden size={18} />
    </ToggleButton>
    <ToggleButton
      active={isItalic}
      disabled={disabled}
      label="Italic"
      onClick={onItalic}
      onMouseDown={preserveSelection}
      shortcut="Control+I Meta+I"
    >
      <Italic aria-hidden size={18} />
    </ToggleButton>
    <ToggleButton
      active={isUnderline}
      disabled={disabled}
      label="Underline"
      onClick={onUnderline}
      onMouseDown={preserveSelection}
      shortcut="Control+U Meta+U"
    >
      <Underline aria-hidden size={18} />
    </ToggleButton>
    <ToggleButton
      active={blockType === "bullet"}
      disabled={disabled}
      label="Bulleted list"
      onClick={onUnorderedList}
      onMouseDown={preserveSelection}
    >
      <List aria-hidden size={18} />
    </ToggleButton>
    <ToggleButton
      active={blockType === "number"}
      disabled={disabled}
      label="Numbered list"
      onClick={onOrderedList}
      onMouseDown={preserveSelection}
    >
      <ListOrdered aria-hidden size={18} />
    </ToggleButton>
    <ToggleButton
      active={isLink}
      disabled={disabled}
      label="Insert link"
      onClick={onLink}
      onMouseDown={preserveSelection}
      shortcut="Control+K Meta+K"
    >
      <Link aria-hidden size={18} />
    </ToggleButton>
    <ToggleButton
      disabled={disabled}
      label="Clear formatting"
      onClick={onClear}
      onMouseDown={preserveSelection}
    >
      <RemoveFormatting aria-hidden size={18} />
    </ToggleButton>
    <ToggleButton
      disabled={disabled || !canUndo}
      label="Undo"
      onClick={onUndo}
      onMouseDown={preserveSelection}
      shortcut="Control+Z Meta+Z"
    >
      <Undo2 aria-hidden size={18} />
    </ToggleButton>
    <ToggleButton
      disabled={disabled || !canRedo}
      label="Redo"
      onClick={onRedo}
      onMouseDown={preserveSelection}
      shortcut="Control+Shift+Z Meta+Shift+Z"
    >
      <Redo2 aria-hidden size={18} />
    </ToggleButton>
  </div>
);
