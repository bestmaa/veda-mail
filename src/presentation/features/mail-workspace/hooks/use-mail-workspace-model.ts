"use client"; import { useCallback, useEffect, useMemo } from "react";
import { createComposerViewModel } from "@/presentation/features/mail-workspace/composer.view-model";
import { createMailListViewModel } from "@/presentation/features/mail-workspace/mail-list.view-model";
import type { MailWorkspaceViewProps } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { useComposerModel } from "@/presentation/features/mail-workspace/hooks/use-composer-model";
import { useEmailSignatureSettingsModel } from "@/presentation/features/mail-workspace/hooks/use-email-signature-settings-model";
import { useEmailSignaturesModel } from "@/presentation/features/mail-workspace/hooks/use-email-signatures-model";
import { useEmailTemplatesModel } from "@/presentation/features/mail-workspace/hooks/use-email-templates-model";
import { useMailDataModel } from "@/presentation/features/mail-workspace/hooks/use-mail-data-model";
import { useMemberSessionModel } from "@/presentation/features/mail-workspace/hooks/use-member-session-model";
import { useMobileNavigationModel } from "@/presentation/features/mail-workspace/hooks/use-mobile-navigation-model";
import { usePartialDeliveryNotice } from "@/presentation/features/mail-workspace/hooks/use-partial-delivery-notice";
import { useAttachmentArchiveDownload } from "@/presentation/features/mail-workspace/hooks/use-attachment-archive-download";
import { useAttachmentDownload } from "@/presentation/features/mail-workspace/hooks/use-attachment-download";
import { useAttachmentPreview } from "@/presentation/features/mail-workspace/hooks/use-attachment-preview";
import { useAccountSettingsModel } from "@/presentation/features/mail-workspace/hooks/use-account-settings-model"; import { useMailRulesModel } from "@/presentation/features/mail-workspace/hooks/use-mail-rules-model";
import { useWorkspaceSnooze } from "@/presentation/features/mail-workspace/hooks/use-workspace-snooze"; import { createReaderViewModel } from "@/presentation/features/mail-workspace/reader.view-model"; import { initials } from "@/presentation/shared/formatters/mail-formatters"; import { createBulkActionsViewModel } from "@/presentation/features/mail-workspace/bulk-actions.view-model";
import { useBulkDestroyConfirmation } from "@/presentation/features/mail-workspace/hooks/use-bulk-destroy-confirmation";
import { useMailboxWorkspaceManagement } from "@/presentation/features/mail-workspace/hooks/use-mailbox-workspace-management";
import { useLabelManagement } from "@/presentation/features/mail-workspace/hooks/use-label-management";
import { useMailboxLifecycle } from "@/presentation/features/mail-workspace/hooks/use-mailbox-lifecycle";
import { useMessageMoveInteractions } from "@/presentation/features/mail-workspace/hooks/use-message-move-interactions";
import { useWorkspacePrimaryActions } from "@/presentation/features/mail-workspace/hooks/use-workspace-primary-actions";
import { createBrandingViewModel, type BrandingInput } from "@/presentation/shared/branding/branding.view-model";
import { DEFAULT_MESSAGE_LIST_PREFERENCES } from "@/domain/mail/message-list-preferences";
import { useMessageListPreferencesModel } from "@/presentation/features/mail-workspace/hooks/use-message-list-preferences-model";
import { useScheduledSendManager } from "@/presentation/features/mail-workspace/hooks/use-scheduled-send-manager";
import { useWorkspaceKeyboardShortcuts } from "@/presentation/features/mail-workspace/hooks/use-workspace-keyboard-shortcuts";
import { useMessageConversationViewModel } from "@/presentation/features/mail-workspace/hooks/use-message-conversation-view-model";
import { resolveReaderMailbox } from "@/presentation/features/mail-workspace/reader-mailbox";
import { useContactsModel } from "@/presentation/features/mail-workspace/hooks/use-contacts-model"; import { useRecipientSuggestionsModel } from "@/presentation/features/mail-workspace/hooks/use-recipient-suggestions-model"; import { useContactManagement } from "@/presentation/features/mail-workspace/hooks/use-contact-management";
interface MailWorkspaceModelOptions { readonly branding: BrandingInput; readonly canSignOut: boolean; readonly initialSessionScope: string; readonly maxAttachmentBytes: number | null; readonly providerLabel: string; readonly signOutPath: string }
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
  const partialDelivery = usePartialDeliveryNotice(mail.refresh, sessionScope, mail.handleSessionFailure); const navigation = useMobileNavigationModel();
  const archiveDownload = useAttachmentArchiveDownload(sessionScope, mail.handleSessionFailure);
  const attachmentDownload = useAttachmentDownload(sessionScope, mail.handleSessionFailure);
  const attachmentPreview = useAttachmentPreview(sessionScope, mail.handleSessionFailure);
  const closeAttachmentPreview = attachmentPreview.close; const brandingView = createBrandingViewModel(branding);
  const workspaceAccountName = mail.workspace?.account.name ?? brandingView.productName;
  const accountEmail = mail.workspace?.account.email ?? "";
  const emailSignatures = useEmailSignaturesModel(sessionScope, mail.handleSessionFailure); const emailTemplates = useEmailTemplatesModel(sessionScope, mail.handleSessionFailure); const scheduled = useScheduledSendManager(sessionScope, mail.handleSessionFailure); const contacts = useContactsModel(sessionScope, mail.handleSessionFailure);
  const { refresh: refreshMail } = mail; const { refresh: refreshScheduled } = scheduled;
  const onDraftChanged = useCallback(() => { refreshMail(); void refreshScheduled(); }, [refreshMail, refreshScheduled]);
  const signatureSettings = useEmailSignatureSettingsModel(accountEmail, emailSignatures, sessionScope);
  const activeMailbox = workspace?.mailboxes.find(({ id }) => id === mail.activeMailboxId) ?? null; const snooze = useWorkspaceSnooze(mail, activeMailbox);
  const rules = useMailRulesModel(sessionScope,
    (workspace?.mailboxes ?? []).filter(({ id, rights, role }) => id !== snooze.snoozedMailboxId && rights.mayAddItems === true && role !== "drafts" && role !== "sent").map(({ id, name }) => ({ id, label: name })),
    (workspace?.labels ?? []).map(({ id, name }) => ({ id, label: name })), mail.handleSessionFailure);
  const isComposerReady = Boolean(sessionScope) &&
    !emailSignatures.isLoading &&
    !emailSignatures.isSaving &&
    !emailSignatures.hasSessionChanged;
  const draftsEnabled = mail.workspace?.draftCapability.status === "supported";
  const composer = useComposerModel(
    (receipt, submittedEmails) => { partialDelivery.onSent(receipt, submittedEmails); contacts.retry(); },
    maxAttachmentBytes,
    emailSignatures.book,
    sessionScope,
    isComposerReady,
    initialSessionScope,
    mail.handleSessionFailure,
    draftsEnabled,
    onDraftChanged,
    recoveryOwner, emailTemplates, scheduled.isAvailable, messageListPreferences,
  );
  const recipientSuggestions = useRecipientSuggestionsModel(contacts.book, composer); const contactManagement = useContactManagement(contacts, sessionScope, mail.handleSessionFailure);
  const session = useMemberSessionModel({
    canSignOut,
    handleSessionFailure: mail.handleSessionFailure,
    requiresConfirmation: Boolean(sessionScope),
    sessionExpiresAt: recoveryExpiresAt ?? "",
    sessionScope,
    signOutPath,
  });
  const settings = useAccountSettingsModel(
    accountEmail, workspaceAccountName, signatureSettings, sessionScope, rules,
    mail.notifications, mail.handleSessionFailure,
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
    mailboxes: (workspace?.mailboxes ?? []).filter(({ id }) => id !== snooze.snoozedMailboxId),
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
    pendingMessageIds: mail.pendingMessageIds,
    snoozedMailboxId: snooze.snoozedMailboxId,
    selectedMessageIds: mail.bulk.selectedIds,
    selectionDisabled: mail.isReaderMutating || mail.bulk.isBusy,
    ...(mail.selectedMessage ? { selectedMessageId: mail.selectedMessage.id } : {}),
    workspace: mail.workspace,
  }), [composer.openSavedDraft, draftsEnabled, mail, mailboxManagement.openEdit,
    messageMove.folder, messageMove.row, navigation, snooze.snoozedMailboxId]);
  const readerMailbox = resolveReaderMailbox(
    workspace?.mailboxes ?? [], mail.activeMailboxId, mail.selectedMessage,
  );
  const readerRole = readerMailbox?.role ?? null; const canPermanentlyDelete = readerMailbox?.rights.mayRemoveItems === true &&
    (readerRole === "spam" || readerRole === "trash");
  const destroyConfirmation = useBulkDestroyConfirmation(mail.bulk.selectedIds.size > 0, () => mail.activeMailboxId && void mail.bulk.mutate({ mailboxId: mail.activeMailboxId, type: "destroy" }));
  const readerDestroyConfirmation = useBulkDestroyConfirmation(Boolean(
    mail.selectedMessage && canPermanentlyDelete && !mail.isReaderMutating,
  ), () => readerMailbox && mail.destroy(readerMailbox.id));
  const bulkActions = createBulkActionsViewModel({
    activeMailboxId: mail.activeMailboxId, bulk: mail.bulk,
    destroyConfirmation, snooze, workspace,
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
  const conversation = useMessageConversationViewModel({
    anchorMessageId: mail.selectedMessage?.id ?? null, handleSessionFailure: mail.handleSessionFailure,
    onOpen: mail.selectMessage, sessionScope,
  });
  const reader = useMemo(
    () =>
      createReaderViewModel({
        archiveDownload,
        attachmentDownload,
        attachmentPreview,
        canArchive: Boolean(mail.workspace?.mailboxes.some(
          ({ role }) => role === "archive",
        ) && readerRole !== "spam" && readerRole !== "trash"),
        conversation,
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
    [mail.isReaderLoading, mail.readerError, mail.selectedMessage, conversation,
      mail.handleSessionFailure, mail.workspace?.mailboxes, readerRole, archiveDownload,
      attachmentDownload, attachmentPreview, sessionScope,
      workspace?.labelCapability, workspace?.labelDeletions, workspace?.labels, mail.setLabel],
  );
  const accountName = settings.profileName ?? workspaceAccountName;
  const primaryActions = useWorkspacePrimaryActions({
    accountEmail, isComposerReady, openCompose: composer.open,
    openForward: composer.openForward, openReply: composer.openReply,
    openReplyAll: composer.openReplyAll,
    requestReaderMove: messageMove.requestReaderMove,
    selectedMailboxId: readerMailbox?.id ?? null,
    selectedMessage: mail.selectedMessage,
  });
  const keyboardShortcuts = useWorkspaceKeyboardShortcuts(
    composer, isComposerReady, mail, mailList, messageListPreferences,
    primaryActions, reader,
  );
  return {
    account: { avatar: initials(accountName), email: accountEmail,
      name: accountName, provider: providerLabel },
    branding: brandingView, ...mailList, bulkActions, contactManagement,
    canPermanentlyDelete,
    composer: createComposerViewModel(composer),
    error: mail.error ?? session.error ??
      (emailSignatures.hasSessionChanged ? emailSignatures.error : null),
    isComposerReady,
    isLoading: mail.isLoading,
    isLoadingMore: mail.isLoadingMore,
    keyboardShortcuts,
    isReaderMutating: mail.isReaderMutating || mail.bulk.isBusy,
    mailboxManagement, mailboxLifecycle, labelManagement,
    messageListPreferences,
    messageMove: {
      announcement: messageMove.announcement,
      dialog: messageMove.dialog,
      onRequestReaderMove: primaryActions.onRequestReaderMove,
    },
    notifications: mail.notifications, loadMoreError: mail.loadMoreError, navigation: { isOpen: navigation.isOpen, onClose: navigation.close,
      onOpen: navigation.open },
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
    reader, recipientSuggestions,
    readerRole,
    readerDestroyConfirmation,
    search: mail.search, searchInput: mail.onSearchInput, snooze,
    searchMaxLength: mail.searchMaxLength,
    searchValue: mail.searchValue, scheduled, undoSend: composer.undoSend,
    session: {
      canSignOut: session.canSignOut,
      confirmation: session.confirmation,
      isSigningOut: session.isSigningOut,
      onSignOut: session.onSignOut,
      privacyCurtain: session.privacyCurtain,
    }, settings, total: mail.workspace?.messages.total ?? 0, hasMoreMessages: Boolean(mail.workspace?.messages.nextCursor), };
};
