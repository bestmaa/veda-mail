import type { ChangeEventHandler, ClipboardEventHandler, DragEventHandler, FormEventHandler, KeyboardEventHandler, MouseEventHandler } from "react";
import type { BrandingViewModel } from "@/presentation/shared/branding/branding.view-model";
import type { AccountSettingsViewModel } from "@/presentation/features/mail-workspace/account-settings.view-model";
import type { ComposerSignatureEditorConfiguration } from "@/presentation/features/mail-workspace/composer-signature-picker.view-model";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import type { ComposerDraftPhase, ComposerTerminalRecoveryKind } from "@/presentation/features/mail-workspace/composer-draft-state";
import type { ComposerDraftStatus } from "@/presentation/features/mail-workspace/composer-draft-status";
import type { ComposerRecoveryPromptViewModel } from "@/presentation/features/mail-workspace/composer-recovery-prompt.view-model";
import type { BulkActionsViewModel } from "@/presentation/features/mail-workspace/bulk-actions.view-model";
export type MailboxIconName =
  "archive" | "custom" | "drafts" | "inbox" | "sent" | "spam" | "trash";
export interface FolderViewModel {
  readonly color: string;
  readonly count: number;
  readonly id: string;
  readonly icon: MailboxIconName;
  readonly isActive: boolean;
  readonly label: string;
  readonly onSelect: () => void;
}
export interface MessageItemViewModel {
  readonly avatar: string;
  readonly canSelect: boolean;
  readonly date: string;
  readonly hasAttachment: boolean;
  readonly id: string;
  readonly isActive: boolean;
  readonly isSelected: boolean;
  readonly isSelectionDisabled: boolean;
  readonly isStarred: boolean;
  readonly isUnread: boolean;
  readonly onSelect: () => void;
  readonly onToggleSelected: () => void;
  readonly openLabel: string;
  readonly preview: string;
  readonly sender: string;
  readonly selectLabel: string;
  readonly subject: string;
}

export interface AttachmentViewModel {
  readonly href: string;
  readonly id: string;
  readonly isDownloading: boolean;
  readonly isPreviewing: boolean;
  readonly meta: string;
  readonly name: string;
  readonly onDownload: () => void;
  readonly onPreview: ((trigger: HTMLButtonElement) => void) | null;
}

export interface ReaderViewModel {
  readonly attachments: readonly AttachmentViewModel[];
  readonly attachmentPreview: {
    readonly error: string | null;
    readonly isLoading: boolean;
    readonly isOpen: boolean;
    readonly name: string;
    readonly onClose: () => void;
    readonly onRestoreFocus: () => void;
    readonly url: string | null;
  };
  readonly avatar: string;
  readonly body: string;
  readonly canArchive: boolean;
  readonly cc: string;
  readonly date: string;
  readonly downloadAll: {
    readonly isPreparing: boolean;
    readonly onClick: () => void;
  } | null;
  readonly error: string | null;
  readonly from: string;
  readonly fromEmail: string;
  readonly htmlBody: string | null;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly isLoading: boolean;
  readonly isStarred: boolean;
  readonly isUnread: boolean;
  readonly messageId: string;
  readonly sessionScope: string;
  readonly subject: string;
  readonly to: string;
}

export interface ComposerViewModel {
  readonly attachmentCapabilityUnavailable: boolean;
  readonly attachments: readonly ComposerAttachmentViewModel[];
  readonly attachmentInput: ChangeEventHandler<HTMLInputElement>;
  readonly bcc: string;
  readonly bccInput: ChangeEventHandler<HTMLInputElement>;
  readonly body: ComposerBodyViewModel;
  readonly cc: string;
  readonly ccInput: ChangeEventHandler<HTMLInputElement>;
  readonly closeConfirmation: ComposerConfirmationViewModel;
  readonly discardConfirmation: ComposerConfirmationViewModel;
  readonly draft: {
    readonly canAttach: boolean; readonly canDiscard: boolean;
    readonly canEdit: boolean;
    readonly canSave: boolean;
    readonly canSend: boolean;
    readonly enabled: boolean;
    readonly error: string | null;
    readonly loadFailed: boolean;
    readonly onReload: (() => void) | null;
    readonly onRequestDiscard: () => void;
    readonly onRetry: () => void;
    readonly onSave: () => void;
    readonly phase: ComposerDraftPhase;
    readonly requiresRecovery: boolean;
    readonly sendBlockedMessage: string | null; readonly status: ComposerDraftStatus | null;
    readonly terminalRecovery: ComposerTerminalRecoveryKind | null;
  };
  readonly error: string | null;
  readonly focusBody: boolean;
  readonly isAttachmentCapabilityRefreshing: boolean;
  readonly isBusy: boolean;
  readonly isOpen: boolean;
  readonly isSending: boolean;
  readonly isUploading: boolean;
  readonly maxAttachmentBytes: number;
  readonly onClose: () => void;
  readonly onRetryAttachmentCapability: () => void;
  readonly onToggleBcc: () => void;
  readonly onToggleCc: () => void;
  readonly recoveryPrompt: ComposerRecoveryPromptViewModel;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly showBcc: boolean;
  readonly showCc: boolean;
  readonly subject: string;
  readonly subjectInput: ChangeEventHandler<HTMLInputElement>;
  readonly to: string;
  readonly toInput: ChangeEventHandler<HTMLInputElement>;
  readonly title: string;
}

export interface ComposerConfirmationViewModel {
  readonly isOpen: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export interface ComposerBodyViewModel {
  readonly cancelPlainMode: () => void;
  readonly confirmPlainMode: () => void;
  readonly editorVersion: number;
  readonly html: string;
  readonly isPlainModeWarningOpen: boolean;
  readonly mode: "plain" | "rich";
  readonly onPlainDrop: DragEventHandler<HTMLTextAreaElement>;
  readonly onPlainInput: ChangeEventHandler<HTMLTextAreaElement>;
  readonly onPlainPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  readonly onRichChange: (snapshot: {
    readonly html: string;
    readonly text: string;
  }) => void;
  readonly onRichInitialize: (snapshot: {
    readonly html: string;
    readonly text: string;
  }) => void;
  readonly onToggleMode: () => void;
  readonly onWarningKeyDown: KeyboardEventHandler<HTMLDivElement>;
  readonly plainTransferStatus: string;
  readonly signature: ComposerSignatureEditorConfiguration | null;
  readonly signatureAnnouncement: string;
  readonly signatureDetached: boolean;
  readonly text: string;
}

export interface ComposerAttachmentViewModel {
  readonly error: string | null;
  readonly id: string;
  readonly meta: string;
  readonly name: string;
  readonly onRemove: () => void;
  readonly onRetry?: () => void;
  readonly state: "error" | "ready" | "uploading";
}

export interface MemberSessionViewModel {
  readonly canSignOut: boolean; readonly confirmation: ComposerConfirmationViewModel;
  readonly isSigningOut: boolean;
  readonly onSignOut: () => void;
  readonly privacyCurtain: {
    readonly error: string | null; readonly isOpen: boolean;
    readonly isPurging: boolean; readonly onRetryCleanup: () => void;
  };
}

interface DeliveryNoticeViewModelBase {
  readonly dismissError: string | null;
  readonly isDismissing: boolean;
  readonly onDismiss: () => void;
  readonly pendingCount: number;
}

export type DeliveryNoticeViewModel = DeliveryNoticeViewModelBase &
  (
    | {
        readonly kind: "partial";
        readonly rejectedRecipients: readonly string[];
      }
    | { readonly kind: "overflow" }
    | { readonly kind: "uncertain" }
  );

export interface MailWorkspaceViewProps {
  readonly account: {
    readonly avatar: string;
    readonly email: string;
    readonly name: string;
    readonly provider: string;
  };
  readonly branding: BrandingViewModel;
  readonly activeFolder: string;
  readonly bulkActions: BulkActionsViewModel;
  readonly composer: ComposerViewModel;
  readonly error: string | null;
  readonly folders: readonly FolderViewModel[];
  readonly isComposerReady: boolean;
  readonly isLoading: boolean; readonly isLoadingMore: boolean;
  readonly loadMoreError: string | null;
  readonly messages: readonly MessageItemViewModel[];
  readonly navigation: {
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly onOpen: () => void;
  };
  readonly onArchive: () => void;
  readonly onCloseReader: () => void;
  readonly onCompose: () => void;
  readonly onDelete: () => void;
  readonly onRefresh: MouseEventHandler<HTMLButtonElement>;
  readonly onForward: () => void;
  readonly onLoadMore: () => void;
  readonly onReply: () => void;
  readonly onReplyAll: () => void;
  readonly onSearchClear: () => void;
  readonly onSearchSubmit: FormEventHandler<HTMLFormElement>;
  readonly onToggleRead: () => void;
  readonly onToggleStar: () => void;
  readonly deliveryNotice: DeliveryNoticeViewModel | null;
  readonly reader: ReaderViewModel | null;
  readonly searchInput: ChangeEventHandler<HTMLInputElement>;
  readonly searchValue: string;
  readonly session: MemberSessionViewModel;
  readonly settings: AccountSettingsViewModel;
  readonly total: number; readonly hasMoreMessages: boolean;
}
