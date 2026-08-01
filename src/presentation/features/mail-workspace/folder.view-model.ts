export type MailboxIconName =
  "archive" | "custom" | "drafts" | "inbox" | "sent" | "spam" | "trash";

export interface FolderViewModel {
  readonly canManage: boolean;
  readonly color: string;
  readonly count: number;
  readonly depth: number;
  readonly id: string;
  readonly icon: MailboxIconName;
  readonly isActive: boolean;
  readonly label: string;
  readonly onManage: () => void;
  readonly onSelect: () => void;
}
