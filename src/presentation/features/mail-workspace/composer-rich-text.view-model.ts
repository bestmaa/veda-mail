import type {
  ChangeEventHandler,
  KeyboardEventHandler,
  MouseEventHandler,
  Ref,
} from "react";

export type ComposerBlockType = "bullet" | "h1" | "h2" | "number" | "p";

export interface ComposerFormattingToolbarProps {
  readonly blockType: ComposerBlockType;
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  readonly disabled: boolean;
  readonly isBold: boolean;
  readonly isItalic: boolean;
  readonly isLink: boolean;
  readonly isUnderline: boolean;
  readonly onBlockTypeChange: ChangeEventHandler<HTMLSelectElement>;
  readonly onBold: () => void;
  readonly onClear: () => void;
  readonly onItalic: () => void;
  readonly onLink: () => void;
  readonly onOrderedList: () => void;
  readonly onRedo: () => void;
  readonly onToolbarKeyDown: KeyboardEventHandler<HTMLDivElement>;
  readonly onUnderline: () => void;
  readonly onUndo: () => void;
  readonly onUnorderedList: () => void;
  readonly preserveSelection: MouseEventHandler<HTMLElement>;
  readonly toolbarRef: Ref<HTMLDivElement>;
}

export interface ComposerLinkEditorProps {
  readonly disabled: boolean;
  readonly error: string | null;
  readonly inputRef: Ref<HTMLInputElement>;
  readonly onApply: () => void;
  readonly onCancel: () => void;
  readonly onInput: ChangeEventHandler<HTMLInputElement>;
  readonly onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  readonly onRemove: () => void;
  readonly value: string;
}
