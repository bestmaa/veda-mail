export type MailboxIconName =
  "archive" | "custom" | "drafts" | "inbox" | "sent" | "spam" | "trash";

export interface FolderViewModel {
  readonly canDrop: boolean;
  readonly canManage: boolean;
  readonly color: string;
  readonly count: number;
  readonly depth: number;
  readonly id: string;
  readonly icon: MailboxIconName;
  readonly isActive: boolean;
  readonly isDropTarget: boolean;
  readonly label: string;
  readonly onManage: () => void;
  readonly onDragEnter: DragEventHandler<HTMLDivElement>;
  readonly onDragLeave: DragEventHandler<HTMLDivElement>;
  readonly onDragOver: DragEventHandler<HTMLDivElement>;
  readonly onDrop: DragEventHandler<HTMLDivElement>;
  readonly onSelect: () => void;
}
import type { DragEventHandler } from "react";
