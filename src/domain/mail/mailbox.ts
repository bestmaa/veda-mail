import type { MailboxId } from "@/domain/shared/brand";
import type { ProviderId } from "@/domain/shared/brand";

export const MAILBOX_COLORS = [
  "#4f46e5",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#a855f7",
  "#ec4899",
  "#64748b",
] as const;

export type MailboxColor = (typeof MAILBOX_COLORS)[number];

export interface MailboxAppearanceOwner {
  readonly email: string;
  readonly providerId: ProviderId;
}

export type MailboxRole =
  "archive" | "drafts" | "inbox" | "sent" | "spam" | "trash" | "custom";

export interface MailboxRights {
  readonly mayAddItems?: boolean;
  readonly mayCreateChild: boolean;
  readonly mayDelete: boolean;
  readonly mayRemoveItems?: boolean;
  readonly mayRename: boolean;
  readonly maySetKeywords?: boolean;
}

export interface Mailbox {
  readonly color: string;
  readonly id: MailboxId;
  readonly name: string;
  readonly parentId: MailboxId | null;
  readonly role: MailboxRole;
  readonly rights: MailboxRights;
  readonly sortOrder: number;
  readonly total: number;
  readonly unread: number;
}

export type MailboxMutation =
  | {
      readonly name: string;
      readonly parentId: MailboxId | null;
      readonly type: "create";
    }
  | {
      readonly mailboxId: MailboxId;
      readonly name?: string;
      readonly parentId?: MailboxId | null;
      readonly type: "update";
    }
  | {
      readonly mailboxId: MailboxId;
      readonly type: "delete";
    };

export interface MailboxMutationResult {
  readonly mailboxId: MailboxId | null;
  readonly mailboxes: readonly Mailbox[];
}
