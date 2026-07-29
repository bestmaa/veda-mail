"use client";

import { useCallback, useMemo } from "react";

import type { MailWorkspaceViewProps } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { useComposerModel } from "@/presentation/features/mail-workspace/hooks/use-composer-model";
import { useMailDataModel } from "@/presentation/features/mail-workspace/hooks/use-mail-data-model";
import { useMemberSessionModel } from "@/presentation/features/mail-workspace/hooks/use-member-session-model";
import { useMobileNavigationModel } from "@/presentation/features/mail-workspace/hooks/use-mobile-navigation-model";
import { useAccountSettingsModel } from "@/presentation/features/mail-workspace/hooks/use-account-settings-model";
import {
  formatFileSize,
  formatFullDate,
  formatMessageDate,
  formatSender,
  initials,
} from "@/presentation/shared/formatters/mail-formatters";
import {
  createBrandingViewModel,
  type BrandingInput,
} from "@/presentation/shared/branding/branding.view-model";

interface MailWorkspaceModelOptions {
  readonly branding: BrandingInput;
  readonly canSignOut: boolean;
  readonly maxAttachmentBytes: number | null;
  readonly providerLabel: string;
  readonly signOutPath: string;
}

export const createAttachmentDownloadHref = (
  messageId: string,
  attachmentId: string,
): string =>
  `/api/v1/mail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;

export const useMailWorkspaceModel = ({
  branding,
  canSignOut,
  maxAttachmentBytes,
  providerLabel,
  signOutPath,
}: MailWorkspaceModelOptions): MailWorkspaceViewProps => {
  const mail = useMailDataModel();
  const composer = useComposerModel(mail.refresh, maxAttachmentBytes);
  const navigation = useMobileNavigationModel();
  const session = useMemberSessionModel(canSignOut, signOutPath);
  const brandingView = createBrandingViewModel(branding);
  const workspaceAccountName =
    mail.workspace?.account.name ?? brandingView.productName;
  const accountEmail = mail.workspace?.account.email ?? "";
  const settings = useAccountSettingsModel(accountEmail, workspaceAccountName);
  const folders = useMemo(
    () =>
      (mail.workspace?.mailboxes ?? []).map((mailbox) => ({
        color: mailbox.color,
        count: mailbox.unread || mailbox.total,
        id: mailbox.id,
        icon: mailbox.role,
        isActive: mailbox.id === mail.activeMailboxId,
        label: mailbox.name,
        onSelect: () => {
          mail.selectMailbox(mailbox.id);
          navigation.close();
        },
      })),
    [mail, navigation],
  );

  const messages = useMemo(
    () =>
      (mail.workspace?.messages.items ?? []).map((message) => {
        const sender = formatSender(message.from);
        return {
          avatar: initials(sender),
          date: formatMessageDate(message.receivedAt),
          hasAttachment: message.hasAttachment,
          id: message.id,
          isActive: message.id === mail.selectedMessage?.id,
          isStarred: message.isStarred,
          isUnread: message.isUnread,
          onSelect: () => mail.selectMessage(message.id),
          preview: message.preview,
          sender,
          subject: message.subject,
        };
      }),
    [mail],
  );

  const reader = useMemo(() => {
    const message = mail.selectedMessage;
    if (!message && !mail.isReaderLoading) {
      return null;
    }
    if (!message) {
      return {
        attachments: [],
        avatar: "",
        body: "",
        canArchive: false,
        cc: "",
        date: "",
        error: mail.readerError,
        from: "",
        fromEmail: "",
        htmlBody: null,
        isLoading: true,
        isStarred: false,
        isUnread: false,
        subject: "Opening message…",
        to: "",
      };
    }
    return {
      attachments: message.attachments.map((attachment) => ({
        href: createAttachmentDownloadHref(message.id, attachment.id),
        id: attachment.id,
        meta: `${attachment.mimeType} · ${formatFileSize(attachment.size)}`,
        name: attachment.name,
      })),
      avatar: initials(formatSender(message.from)),
      body: message.textBody,
      canArchive: Boolean(
        mail.workspace?.mailboxes.some((mailbox) => mailbox.role === "archive"),
      ),
      cc: message.cc.map((address) => address.email).join(", "),
      date: formatFullDate(message.receivedAt),
      error: mail.readerError,
      from: formatSender(message.from),
      fromEmail: message.from[0]?.email ?? "",
      htmlBody: message.htmlBody,
      isLoading: mail.isReaderLoading,
      isStarred: message.isStarred,
      isUnread: message.isUnread,
      subject: message.subject,
      to: message.to.map((address) => address.email).join(", "),
    };
  }, [
    mail.isReaderLoading,
    mail.readerError,
    mail.selectedMessage,
    mail.workspace?.mailboxes,
  ]);

  const activeFolder =
    mail.workspace?.mailboxes.find(
      (mailbox) => mailbox.id === mail.activeMailboxId,
    )?.name ?? "Inbox";
  const accountName = settings.profileName ?? workspaceAccountName;
  const onReply = useCallback(
    () => composer.openReply(mail.selectedMessage),
    [composer, mail.selectedMessage],
  );
  const onReplyAll = useCallback(
    () => composer.openReplyAll(mail.selectedMessage, accountEmail),
    [accountEmail, composer, mail.selectedMessage],
  );
  const onForward = useCallback(
    () => composer.openForward(mail.selectedMessage),
    [composer, mail.selectedMessage],
  );

  return {
    account: {
      avatar: initials(accountName),
      email: accountEmail,
      name: accountName,
      provider: providerLabel,
    },
    branding: brandingView,
    activeFolder,
    composer: {
      attachments: composer.attachments.map((attachment) => ({
        error: attachment.error,
        id: attachment.key,
        meta: `${formatFileSize(attachment.size)} · ${
          attachment.state === "ready"
            ? attachment.upload?.mimeType
            : attachment.state === "uploading"
              ? "Scanning…"
              : "Upload failed"
        }`,
        name: attachment.name,
        onRemove: () => composer.removeAttachment(attachment.key),
        state: attachment.state,
      })),
      attachmentInput: composer.onAttachmentInput,
      attachmentCapabilityUnavailable: composer.attachmentCapabilityUnavailable,
      bcc: composer.bcc,
      bccInput: composer.onBccInput,
      body: composer.body,
      bodyInput: composer.onBodyInput,
      cc: composer.cc,
      ccInput: composer.onCcInput,
      error: composer.error,
      focusBody: Boolean(composer.to),
      isAttachmentCapabilityRefreshing:
        composer.isAttachmentCapabilityRefreshing,
      isOpen: composer.isOpen,
      isSending: composer.isSending,
      isUploading: composer.isUploading,
      maxAttachmentBytes: composer.maxAttachmentBytes,
      onClose: composer.close,
      onRetryAttachmentCapability: composer.onRetryAttachmentCapability,
      onToggleBcc: composer.onToggleBcc,
      onToggleCc: composer.onToggleCc,
      onSubmit: composer.onSubmit,
      showBcc: composer.showBcc,
      showCc: composer.showCc,
      subject: composer.subject,
      subjectInput: composer.onSubjectInput,
      to: composer.to,
      toInput: composer.onToInput,
      title: composer.title,
    },
    error: mail.error ?? session.error,
    folders,
    isLoading: mail.isLoading,
    messages,
    navigation: {
      isOpen: navigation.isOpen,
      onClose: navigation.close,
      onOpen: navigation.open,
    },
    onArchive: mail.archive,
    onCloseReader: mail.closeReader,
    onCompose: composer.open,
    onDelete: mail.remove,
    onForward,
    onRefresh: mail.onRefresh,
    onReply,
    onReplyAll,
    onSearchClear: mail.onSearchClear,
    onSearchSubmit: mail.onSearchSubmit,
    onToggleRead: mail.toggleRead,
    onToggleStar: mail.toggleStar,
    reader,
    searchInput: mail.onSearchInput,
    searchValue: mail.searchValue,
    session: {
      canSignOut: session.canSignOut,
      isSigningOut: session.isSigningOut,
      onSignOut: session.onSignOut,
    },
    settings,
    total: mail.workspace?.messages.total ?? 0,
  };
};
