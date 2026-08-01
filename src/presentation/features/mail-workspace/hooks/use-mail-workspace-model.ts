"use client";
import { useEffect, useMemo } from "react";
import { createComposerViewModel } from "@/presentation/features/mail-workspace/composer.view-model";
import { createMailListViewModel } from "@/presentation/features/mail-workspace/mail-list.view-model";
import type { MailWorkspaceViewProps } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { useComposerModel } from "@/presentation/features/mail-workspace/hooks/use-composer-model";
import { useEmailSignatureSettingsModel } from "@/presentation/features/mail-workspace/hooks/use-email-signature-settings-model";
import { useEmailSignaturesModel } from "@/presentation/features/mail-workspace/hooks/use-email-signatures-model";
import { useMailDataModel } from "@/presentation/features/mail-workspace/hooks/use-mail-data-model";
import { useMemberSessionModel } from "@/presentation/features/mail-workspace/hooks/use-member-session-model";
import { useMobileNavigationModel } from "@/presentation/features/mail-workspace/hooks/use-mobile-navigation-model";
import { usePartialDeliveryNotice } from "@/presentation/features/mail-workspace/hooks/use-partial-delivery-notice";
import { useAttachmentArchiveDownload } from "@/presentation/features/mail-workspace/hooks/use-attachment-archive-download";
import { useAttachmentDownload } from "@/presentation/features/mail-workspace/hooks/use-attachment-download";
import { useAttachmentPreview } from "@/presentation/features/mail-workspace/hooks/use-attachment-preview";
import { useAccountSettingsModel } from "@/presentation/features/mail-workspace/hooks/use-account-settings-model";
import { createReaderViewModel } from "@/presentation/features/mail-workspace/reader.view-model";
import { initials } from "@/presentation/shared/formatters/mail-formatters";
import { createBulkActionsViewModel } from "@/presentation/features/mail-workspace/bulk-actions.view-model";
import { useBulkDestroyConfirmation } from "@/presentation/features/mail-workspace/hooks/use-bulk-destroy-confirmation";
import { useMailboxWorkspaceManagement } from "@/presentation/features/mail-workspace/hooks/use-mailbox-workspace-management";
import { useLabelManagement } from "@/presentation/features/mail-workspace/hooks/use-label-management";
import { useMailboxLifecycle } from "@/presentation/features/mail-workspace/hooks/use-mailbox-lifecycle";
import { useMessageMoveInteractions } from "@/presentation/features/mail-workspace/hooks/use-message-move-interactions";
import { useWorkspacePrimaryActions } from "@/presentation/features/mail-workspace/hooks/use-workspace-primary-actions";
import { createBrandingViewModel, type BrandingInput } from "@/presentation/shared/branding/branding.view-model";
import { DEFAULT_MESSAGE_LIST_PREFERENCES } from "@/domain/mail/message-list-preferences";
import { useMessageListPreferencesModel } from "@/presentation/features/mail-workspace/hooks/use-message-list-preferences-model";
interface MailWorkspaceModelOptions {
  readonly branding: BrandingInput; readonly canSignOut: boolean; readonly initialSessionScope: string;
  readonly maxAttachmentBytes: number | null; readonly providerLabel: string; readonly signOutPath: string }
export const useMailWorkspaceModel = ({
  branding, canSignOut, initialSessionScope, maxAttachmentBytes, providerLabel, signOutPath,
}: MailWorkspaceModelOptions): MailWorkspaceViewProps => {
  const mail = useMailDataModel();
  const workspace = mail.workspace;
  const messageListPreferences = useMessageListPreferencesModel(workspace?.messageListPreferences ?? DEFAULT_MESSAGE_LIST_PREFERENCES, mail.saveListPreferences);
  const sessionScope = workspace?.sessionScope ?? "";
  const recoveryAccountId = workspace?.account.id ?? null;
  const recoveryProviderId = workspace?.account.providerId ?? null;
  const recoveryExpiresAt = workspace?.sessionExpiresAt ?? null;
  const recoveryOwner = useMemo(() =>
    recoveryAccountId && recoveryProviderId && recoveryExpiresAt && sessionScope
      ? { accountId: recoveryAccountId, providerId: recoveryProviderId,
          sessionExpiresAt: recoveryExpiresAt, sessionScope }
      : null,
  [recoveryAccountId, recoveryExpiresAt, recoveryProviderId, sessionScope]);
  const partialDelivery = usePartialDeliveryNotice(mail.refresh, sessionScope, mail.handleSessionFailure);
  const navigation = useMobileNavigationModel();
  const archiveDownload = useAttachmentArchiveDownload(sessionScope, mail.handleSessionFailure);
  const attachmentDownload = useAttachmentDownload(sessionScope, mail.handleSessionFailure);
  const attachmentPreview = useAttachmentPreview(sessionScope, mail.handleSessionFailure);
  const closeAttachmentPreview = attachmentPreview.close;
  const brandingView = createBrandingViewModel(branding);
  const workspaceAccountName = mail.workspace?.account.name ?? brandingView.productName;
  const accountEmail = mail.workspace?.account.email ?? "";
  const emailSignatures = useEmailSignaturesModel(sessionScope, mail.handleSessionFailure);
  const signatureSettings = useEmailSignatureSettingsModel(accountEmail, emailSignatures, sessionScope);
  const isComposerReady =
    Boolean(sessionScope) &&
    !emailSignatures.isLoading &&
    !emailSignatures.isSaving &&
    !emailSignatures.hasSessionChanged;
  const draftsEnabled = mail.workspace?.draftCapability.status === "supported";
  const composer = useComposerModel(
    partialDelivery.onSent,
    maxAttachmentBytes,
    emailSignatures.book,
    sessionScope,
    isComposerReady,
    initialSessionScope,
    mail.handleSessionFailure,
    draftsEnabled,
    mail.refresh,
    recoveryOwner,
  );
  const session = useMemberSessionModel({
    canSignOut,
    handleSessionFailure: mail.handleSessionFailure,
    requiresConfirmation: Boolean(sessionScope),
    sessionExpiresAt: recoveryExpiresAt ?? "",
    sessionScope,
    signOutPath,
  });
  const settings = useAccountSettingsModel(
    accountEmail, workspaceAccountName, signatureSettings, sessionScope, mail.handleSessionFailure,
  );
  const mailboxManagement = useMailboxWorkspaceManagement(mail);
  const labelManagement = useLabelManagement({
    deletions: workspace?.labelDeletions ?? [],
    handleSessionFailure: mail.handleSessionFailure,
    isSupported: workspace?.labelCapability === "supported",
    labels: workspace?.labels ?? [],
    refresh: mail.refresh,
    sessionScope,
  });
  const messageMove = useMessageMoveInteractions({
    activeMailboxId: mail.activeMailboxId,
    isBusy: mail.bulk.isBusy || mail.isReaderMutating,
    mailboxes: workspace?.mailboxes ?? [],
    messages: workspace?.messages.items ?? [],
    mutateIds: mail.bulk.mutateIds,
    selectedIds: mail.bulk.selectedIds,
    sessionScope,
    viewKey: mail.viewKey,
  });
  const mailList = useMemo(() => createMailListViewModel({
    activeMailboxId: mail.activeMailboxId,
    draftsEnabled,
    folderMoveProps: messageMove.folder,
    messageMoveProps: messageMove.row,
    onOpenDraft: composer.openSavedDraft,
    onManageMailbox: mailboxManagement.openEdit,
    onSelectMailbox: (mailboxId) => {
      mail.selectMailbox(mailboxId);
      navigation.close();
    },
    onSelectMessage: mail.selectMessage,
    onToggleMessage: mail.bulk.toggle,
    selectedMessageIds: mail.bulk.selectedIds,
    selectionDisabled: mail.bulk.isBusy,
    ...(mail.selectedMessage ? { selectedMessageId: mail.selectedMessage.id } : {}),
    workspace: mail.workspace,
  }), [composer.openSavedDraft, draftsEnabled, mail, mailboxManagement.openEdit,
    messageMove.folder, messageMove.row, navigation]);
  const activeMailbox = workspace?.mailboxes.find(
    (mailbox) => mailbox.id === mail.activeMailboxId);
  const canPermanentlyDelete = activeMailbox?.rights.mayRemoveItems === true &&
    (activeMailbox.role === "spam" || activeMailbox.role === "trash");
  const destroyConfirmation = useBulkDestroyConfirmation(mail.bulk.selectedIds.size > 0, () => mail.activeMailboxId && void mail.bulk.mutate({ mailboxId: mail.activeMailboxId, type: "destroy" }));
  const readerDestroyConfirmation = useBulkDestroyConfirmation(
    Boolean(mail.selectedMessage && canPermanentlyDelete && !mail.isReaderMutating),
    () => {
      if (mail.activeMailboxId) mail.destroy(mail.activeMailboxId);
    },
  );
  const bulkActions = createBulkActionsViewModel({
    activeMailboxId: mail.activeMailboxId, bulk: mail.bulk,
    destroyConfirmation, workspace,
  });
  const mailboxLifecycle = useMailboxLifecycle({
    activeMailboxId: mail.activeMailboxId, activeRole: mailList.activeRole,
    bulkBusy: mail.bulk.isBusy, handleSessionFailure: mail.handleSessionFailure,
    hasActiveSearch: mail.hasActiveSearch,
    mayRemoveItems: activeMailbox?.rights.mayRemoveItems === true,
    operations: workspace?.mailboxEmptyOperations ?? [], refresh: mail.refresh,
    sessionScope, total: workspace?.messages.total ?? 0,
  });
  useEffect(() => closeAttachmentPreview(), [closeAttachmentPreview, mail.selectedMessage?.id]);
  const reader = useMemo(
    () =>
      createReaderViewModel({
        archiveDownload,
        attachmentDownload,
        attachmentPreview,
        canArchive: Boolean(
          mail.workspace?.mailboxes.some(
            (mailbox) => mailbox.role === "archive",
          ) && mailList.activeRole !== "spam" && mailList.activeRole !== "trash",
        ),
        deletingLabelIds: new Set((workspace?.labelDeletions ?? []).map(({ labelId }) => labelId)),
        handleSessionFailure: mail.handleSessionFailure,
        isLoading: mail.isReaderLoading,
        message: mail.selectedMessage,
        labels: workspace?.labels ?? [],
        labelCapability: workspace?.labelCapability ?? "unsupported",
        onSetLabel: mail.setLabel,
        readerError: mail.readerError,
        sessionScope,
      }),
    [mail.isReaderLoading, mail.readerError, mail.selectedMessage,
      mail.handleSessionFailure, mail.workspace?.mailboxes, mailList.activeRole, archiveDownload,
      attachmentDownload, attachmentPreview, sessionScope,
      workspace?.labelCapability, workspace?.labelDeletions, workspace?.labels, mail.setLabel],
  );
  const accountName = settings.profileName ?? workspaceAccountName;
  const primaryActions = useWorkspacePrimaryActions({
    accountEmail,
    isComposerReady,
    openCompose: composer.open,
    openForward: composer.openForward,
    openReply: composer.openReply,
    openReplyAll: composer.openReplyAll,
    requestReaderMove: messageMove.requestReaderMove,
    selectedMessage: mail.selectedMessage,
  });
  return {
    account: {
      avatar: initials(accountName),
      email: accountEmail,
      name: accountName,
      provider: providerLabel,
    },
    branding: brandingView, ...mailList, bulkActions,
    canPermanentlyDelete,
    composer: createComposerViewModel(composer),
    error:
      mail.error ??
      session.error ??
      (emailSignatures.hasSessionChanged ? emailSignatures.error : null),
    isComposerReady,
    isLoading: mail.isLoading,
    isLoadingMore: mail.isLoadingMore,
    isReaderMutating: mail.isReaderMutating || mail.bulk.isBusy,
    mailboxManagement, mailboxLifecycle, labelManagement,
    messageListPreferences,
    messageMove: {
      announcement: messageMove.announcement,
      dialog: messageMove.dialog,
      onRequestReaderMove: primaryActions.onRequestReaderMove,
    },
    loadMoreError: mail.loadMoreError,
    navigation: {
      isOpen: navigation.isOpen,
      onClose: navigation.close,
      onOpen: navigation.open,
    },
    onArchive: mail.archive,
    onCloseReader: mail.closeReader,
    onCompose: primaryActions.onCompose,
    onDelete: mail.remove,
    onForward: primaryActions.onForward,
    onLoadMore: mail.onLoadMore,
    onRefresh: mail.onRefresh,
    onReply: primaryActions.onReply,
    onReplyAll: primaryActions.onReplyAll,
    onRequestReaderDestroy: readerDestroyConfirmation.onRequest,
    onRestore: mail.restore,
    onSearchClear: mail.onSearchClear,
    onSearchSubmit: mail.onSearchSubmit,
    onToggleRead: mail.toggleRead,
    onToggleStar: mail.toggleStar,
    deliveryNotice: partialDelivery.notice,
    reader,
    readerDestroyConfirmation,
    searchInput: mail.onSearchInput,
    searchValue: mail.searchValue,
    session: {
      canSignOut: session.canSignOut,
      confirmation: session.confirmation,
      isSigningOut: session.isSigningOut,
      onSignOut: session.onSignOut,
      privacyCurtain: session.privacyCurtain,
    },
    settings,
    total: mail.workspace?.messages.total ?? 0,
    hasMoreMessages: Boolean(mail.workspace?.messages.nextCursor),
  };
};
