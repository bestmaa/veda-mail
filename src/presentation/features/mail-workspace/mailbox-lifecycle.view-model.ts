import type { MailboxRole } from "@/domain/mail/mail";

export interface MailboxLifecycleViewModel {
  readonly confirmation: {
    readonly description: string;
    readonly isOpen: boolean;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
    readonly title: string;
  };
  readonly disabledReason: string | null;
  readonly emptyLabel: string;
  readonly error: string | null;
  readonly isBusy: boolean;
  readonly onRequestEmpty: () => void;
  readonly retentionHint: string;
  readonly role: "spam" | "trash" | null;
  readonly status: string;
}

interface MailboxLifecycleState {
  readonly activeRole: MailboxRole | null;
  readonly error: string | null;
  readonly hasActiveSearch: boolean;
  readonly isBusy: boolean;
  readonly isConfirming: boolean;
  readonly mayRemoveItems: boolean;
  readonly status: string;
  readonly total: number;
}

interface MailboxLifecycleOptions extends MailboxLifecycleState {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly onRequestEmpty: () => void;
}

export type MailboxLifecycleCopy = Omit<
  MailboxLifecycleViewModel,
  "confirmation" | "onRequestEmpty"
> & {
  readonly confirmation: Omit<
    MailboxLifecycleViewModel["confirmation"],
    "onCancel" | "onConfirm"
  >;
};

export const createMailboxLifecycleCopy = ({
  activeRole,
  error,
  hasActiveSearch,
  isBusy,
  isConfirming,
  mayRemoveItems,
  status,
  total,
}: MailboxLifecycleState): MailboxLifecycleCopy => {
  const role = activeRole === "spam" || activeRole === "trash"
    ? activeRole
    : null;
  const title = role === "spam" ? "Spam" : "Trash";
  const disabledReason = !role
    ? null
    : hasActiveSearch
      ? `Clear the active search before emptying ${title}.`
      : !mayRemoveItems
        ? `Your mail provider does not allow permanently removing items from ${title}.`
      : total === 0
        ? `${title} is already empty.`
        : isBusy
          ? `Wait for the current ${title} cleanup to finish.`
          : null;
  return {
    confirmation: {
      description:
        `All messages currently in ${title} will be permanently removed ` +
        "from the mail provider. This cannot be undone.",
      isOpen: Boolean(role) && isConfirming,
      title: `Empty ${title} permanently?`,
    },
    disabledReason,
    emptyLabel: `Empty ${title}`,
    error,
    isBusy,
    retentionHint: role
      ? `Your mail provider may automatically remove messages from ${title} ` +
        "according to its retention policy."
      : "",
    role,
    status,
  };
};

export const createMailboxLifecycleViewModel = ({
  onCancel,
  onConfirm,
  onRequestEmpty,
  ...state
}: MailboxLifecycleOptions): MailboxLifecycleViewModel => {
  const copy = createMailboxLifecycleCopy(state);
  return {
    ...copy,
    confirmation: { ...copy.confirmation, onCancel, onConfirm },
    onRequestEmpty,
  };
};
