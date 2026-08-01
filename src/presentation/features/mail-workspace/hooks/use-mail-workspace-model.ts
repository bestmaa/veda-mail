"use client";

import { useCallback, useEffect, useMemo } from "react";

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
import {
  createBrandingViewModel,
  type BrandingInput,
} from "@/presentation/shared/branding/branding.view-model";

interface MailWorkspaceModelOptions {
  readonly branding: BrandingInput;
  readonly canSignOut: boolean;
  readonly initialSessionScope: string;
  readonly maxAttachmentBytes: number | null;
  readonly providerLabel: string;
  readonly signOutPath: string;
}

export const useMailWorkspaceModel = ({
  branding,
  canSignOut,
  initialSessionScope,
  maxAttachmentBytes,
  providerLabel,
  signOutPath,
}: MailWorkspaceModelOptions): MailWorkspaceViewProps => {
  const mail = useMailDataModel();
  const workspace = mail.workspace;
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
  const partialDelivery = usePartialDeliveryNotice(
    mail.refresh,
    sessionScope,
    mail.handleSessionFailure,
  );
  const navigation = useMobileNavigationModel();
  const archiveDownload = useAttachmentArchiveDownload(sessionScope, mail.handleSessionFailure);
  const attachmentDownload = useAttachmentDownload(sessionScope, mail.handleSessionFailure);
  const attachmentPreview = useAttachmentPreview(sessionScope, mail.handleSessionFailure);
  const closeAttachmentPreview = attachmentPreview.close;
  const brandingView = createBrandingViewModel(branding);
  const workspaceAccountName =
    mail.workspace?.account.name ?? brandingView.productName;
  const accountEmail = mail.workspace?.account.email ?? "";
  const emailSignatures = useEmailSignaturesModel(sessionScope, mail.handleSessionFailure);
  const signatureSettings = useEmailSignatureSettingsModel(
    accountEmail,
    emailSignatures,
    sessionScope,
  );
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
    accountEmail,
    workspaceAccountName,
    signatureSettings,
    sessionScope,
    mail.handleSessionFailure,
  );
  const mailList = useMemo(() => createMailListViewModel({
    activeMailboxId: mail.activeMailboxId,
    draftsEnabled,
    onOpenDraft: composer.openSavedDraft,
    onSelectMailbox: (mailboxId) => {
      mail.selectMailbox(mailboxId);
      navigation.close();
    },
    onSelectMessage: mail.selectMessage,
    ...(mail.selectedMessage ? { selectedMessageId: mail.selectedMessage.id } : {}),
    workspace: mail.workspace,
  }), [composer.openSavedDraft, draftsEnabled, mail, navigation]);

  useEffect(() => {
    closeAttachmentPreview();
  }, [closeAttachmentPreview, mail.selectedMessage?.id]);

  const reader = useMemo(
    () =>
      createReaderViewModel({
        archiveDownload,
        attachmentDownload,
        attachmentPreview,
        canArchive: Boolean(
          mail.workspace?.mailboxes.some(
            (mailbox) => mailbox.role === "archive",
          ),
        ),
        handleSessionFailure: mail.handleSessionFailure,
        isLoading: mail.isReaderLoading,
        message: mail.selectedMessage,
        readerError: mail.readerError,
        sessionScope,
      }),
    [
      mail.isReaderLoading,
      mail.readerError,
      mail.selectedMessage,
      mail.handleSessionFailure,
      mail.workspace?.mailboxes,
      archiveDownload,
      attachmentDownload,
      attachmentPreview,
      sessionScope,
    ],
  );

  const accountName = settings.profileName ?? workspaceAccountName;
  const onReply = useCallback(
    () => {
      if (isComposerReady) composer.openReply(mail.selectedMessage);
    },
    [composer, isComposerReady, mail.selectedMessage],
  );
  const onReplyAll = useCallback(
    () => {
      if (isComposerReady) {
        composer.openReplyAll(mail.selectedMessage, accountEmail);
      }
    },
    [accountEmail, composer, isComposerReady, mail.selectedMessage],
  );
  const onForward = useCallback(
    () => {
      if (isComposerReady) composer.openForward(mail.selectedMessage);
    },
    [composer, isComposerReady, mail.selectedMessage],
  );
  const onCompose = useCallback(
    () => {
      if (isComposerReady) composer.open();
    },
    [composer, isComposerReady],
  );

  return {
    account: {
      avatar: initials(accountName),
      email: accountEmail,
      name: accountName,
      provider: providerLabel,
    },
    branding: brandingView,
    activeFolder: mailList.activeFolder,
    composer: createComposerViewModel(composer),
    error:
      mail.error ??
      session.error ??
      (emailSignatures.hasSessionChanged ? emailSignatures.error : null),
    folders: mailList.folders,
    isComposerReady,
    isLoading: mail.isLoading,
    messages: mailList.messages,
    navigation: {
      isOpen: navigation.isOpen,
      onClose: navigation.close,
      onOpen: navigation.open,
    },
    onArchive: mail.archive,
    onCloseReader: mail.closeReader,
    onCompose,
    onDelete: mail.remove,
    onForward,
    onRefresh: mail.onRefresh,
    onReply,
    onReplyAll,
    onSearchClear: mail.onSearchClear,
    onSearchSubmit: mail.onSearchSubmit,
    onToggleRead: mail.toggleRead,
    onToggleStar: mail.toggleStar,
    deliveryNotice: partialDelivery.notice,
    reader,
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
  };
};
