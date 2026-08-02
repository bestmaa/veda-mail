import { PenLine } from "lucide-react";

import { ComposerRecoveryPromptConnector } from "@/presentation/features/mail-workspace/connectors/composer-recovery-prompt.connector";
import { BulkDestroyConfirmationConnector } from "@/presentation/features/mail-workspace/connectors/bulk-destroy-confirmation.connector";
import { MailboxEmptyConfirmationConnector } from "@/presentation/features/mail-workspace/connectors/mailbox-empty-confirmation.connector";
import { ReaderDestroyConfirmationConnector } from "@/presentation/features/mail-workspace/connectors/reader-destroy-confirmation.connector";
import { MemberSignOutConfirmationConnector } from "@/presentation/features/mail-workspace/connectors/member-sign-out-confirmation.connector";
import { MessageMoveDialogConnector } from "@/presentation/features/mail-workspace/connectors/message-move-dialog.connector";
import type { MailWorkspaceViewProps } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { AccountSettingsView } from "@/presentation/features/mail-workspace/ui/account-settings.view";
import { ComposerView } from "@/presentation/features/mail-workspace/ui/composer.view";
import { EmptyReaderView } from "@/presentation/features/mail-workspace/ui/empty-reader.view";
import { MailHeaderView } from "@/presentation/features/mail-workspace/ui/mail-header.view";
import { MailSidebarView } from "@/presentation/features/mail-workspace/ui/mail-sidebar.view";
import { MemberSessionPrivacyCurtainView } from "@/presentation/features/mail-workspace/ui/member-session-privacy-curtain.view";
import { MessageListView } from "@/presentation/features/mail-workspace/ui/message-list.view";
import { MessageReaderView } from "@/presentation/features/mail-workspace/ui/message-reader.view";
import { PartialDeliveryNoticeView } from "@/presentation/features/mail-workspace/ui/partial-delivery-notice.view";
import { MailboxManagementView } from "@/presentation/features/mail-workspace/ui/mailbox-management.view";
import { LabelManagementView } from "@/presentation/features/mail-workspace/ui/label-management.view";
import { MessageListPreferencesDialogConnector } from "@/presentation/features/mail-workspace/connectors/message-list-preferences-dialog.connector";
import { ScheduledSendManagerConnector } from "@/presentation/features/mail-workspace/connectors/scheduled-send-manager.connector";
import { UndoSendNoticeView } from "@/presentation/features/mail-workspace/ui/undo-send-notice.view";
import { KeyboardShortcutsDialogConnector } from "@/presentation/features/mail-workspace/connectors/keyboard-shortcuts-dialog.connector";
import { ReaderFocusConnector } from "@/presentation/features/mail-workspace/connectors/reader-focus.connector";

export const MailWorkspaceView = (props: MailWorkspaceViewProps) => {
  if (props.session.privacyCurtain.isOpen) {
    return (
      <MemberSessionPrivacyCurtainView
        privacy={props.session.privacyCurtain}
      />
    );
  }
  const topLevelModalOpen = props.composer.recoveryPrompt.isOpen ||
    props.session.confirmation.isOpen ||
    props.bulkActions.destroyConfirmation.isOpen ||
    props.readerDestroyConfirmation.isOpen ||
    props.mailboxLifecycle.confirmation.isOpen ||
    props.mailboxManagement.isOpen ||
    props.labelManagement.isOpen ||
    props.keyboardShortcuts.dialog.isOpen ||
    props.messageListPreferences.dialog.isOpen ||
    props.scheduled.isOpen ||
    props.messageMove.dialog.isOpen;
  return (
  <>
  <main
    className="h-dvh min-h-[620px] overflow-hidden bg-[#f8f9fc] text-slate-900"
    style={props.branding.brandStyle}
    {...(topLevelModalOpen ? { "aria-hidden": true, inert: true } : {})}
  >
    <a
      className="fixed left-4 top-2 z-[120] -translate-y-20 rounded-xl bg-white px-4 py-2 text-sm font-bold text-indigo-700 shadow-xl focus:translate-y-0"
      href="#message-list-region"
    >
      Skip to message list
    </a>
    <MailHeaderView
      account={props.account}
      branding={props.branding}
      keyboardShortcuts={props.keyboardShortcuts}
      navigation={props.navigation}
      onRefresh={props.onRefresh}
      onSearchClear={props.onSearchClear}
      onSearchSubmit={props.onSearchSubmit}
      search={props.search}
      searchInput={props.searchInput}
      searchMaxLength={props.searchMaxLength}
      searchValue={props.searchValue}
      settings={props.settings}
    />
    {props.navigation.isOpen ? (
      <button
        aria-label="Close navigation"
        className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[1px] md:hidden"
        onClick={props.navigation.onClose}
        type="button"
      />
    ) : null}
    <div className="mail-workspace-grid h-[calc(100dvh-72px)] min-h-0">
      <MailSidebarView
        account={props.account}
        branding={props.branding}
        folders={props.folders}
        isComposerReady={props.isComposerReady}
        keyboardShortcutsEnabled={props.keyboardShortcuts.enabled}
        isMobileOpen={props.navigation.isOpen}
        mailboxManagement={props.mailboxManagement}
        labelManagement={props.labelManagement}
        onCloseNavigation={props.navigation.onClose}
        onCompose={props.onCompose}
        session={props.session}
        scheduled={props.scheduled}
        settings={props.settings}
      />
      <div
        className={`min-h-0 ${props.reader ? "hidden lg:block" : "block"}`}
      >
        <MessageListView
          activeFolder={props.activeFolder}
          activeRole={props.activeRole}
          bulkActions={props.bulkActions}
          error={props.error}
          hasMore={props.hasMoreMessages}
          isLoading={props.isLoading}
          isLoadingMore={props.isLoadingMore}
          loadMoreError={props.loadMoreError}
          messages={props.messages}
          preferences={props.messageListPreferences}
          search={props.search}
          mailboxLifecycle={props.mailboxLifecycle}
          moveAnnouncement={props.messageMove.announcement}
          onLoadMore={props.onLoadMore}
          total={props.total}
        />
      </div>
      <div
        className={`min-h-0 ${props.reader ? "block" : "hidden lg:block"}`}
      >
        {props.reader ? (
          <MessageReaderView
            activeRole={props.activeRole}
            canPermanentlyDelete={props.canPermanentlyDelete}
            isComposerReady={props.isComposerReady}
            keyboardShortcutsEnabled={props.keyboardShortcuts.enabled}
            isMutating={props.isReaderMutating}
            onArchive={props.onArchive}
            onClose={props.onCloseReader}
            onDelete={props.onDelete}
            onForward={props.onForward}
            onReply={props.onReply}
            onReplyAll={props.onReplyAll}
            onRequestDestroy={props.onRequestReaderDestroy}
            onRequestMove={props.messageMove.onRequestReaderMove}
            onRestore={props.onRestore}
            onToggleRead={props.onToggleRead}
            onToggleStar={props.onToggleStar}
            reader={props.reader}
          />
        ) : (
          <EmptyReaderView
            isComposerReady={props.isComposerReady}
            onCompose={props.onCompose}
          />
        )}
      </div>
    </div>

    <button
      aria-label="Compose a new message"
      aria-busy={!props.isComposerReady}
      aria-keyshortcuts={props.keyboardShortcuts.enabled ? "C" : undefined}
      className="fixed bottom-5 right-5 z-30 grid size-14 place-items-center rounded-2xl bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)] shadow-xl disabled:cursor-wait disabled:opacity-70 md:hidden"
      disabled={!props.isComposerReady}
      onClick={props.onCompose}
      title={props.isComposerReady ? undefined : "Loading account settings"}
      type="button"
    >
      <PenLine aria-hidden size={21} />
    </button>
    {props.deliveryNotice && !props.composer.isOpen ? (
      <PartialDeliveryNoticeView notice={props.deliveryNotice} />
    ) : null}
    <ComposerView
      composer={props.composer}
      deliveryNotice={props.deliveryNotice}
    />
    <AccountSettingsView settings={props.settings} />
    <ReaderFocusConnector
      isLoading={props.reader?.isLoading ?? false}
      messageId={props.reader?.messageId ?? null}
    />
  </main>
  <ComposerRecoveryPromptConnector prompt={props.composer.recoveryPrompt} />
  <BulkDestroyConfirmationConnector bulk={props.bulkActions} />
  <MailboxEmptyConfirmationConnector lifecycle={props.mailboxLifecycle} />
  <ReaderDestroyConfirmationConnector
    confirmation={props.readerDestroyConfirmation}
  />
  <MemberSignOutConfirmationConnector session={props.session} />
  <MessageMoveDialogConnector move={props.messageMove} />
  <MessageListPreferencesDialogConnector
    preferences={props.messageListPreferences}
  />
  <MailboxManagementView management={props.mailboxManagement} />
  <LabelManagementView management={props.labelManagement} />
  <ScheduledSendManagerConnector manager={props.scheduled} />
  <UndoSendNoticeView undo={props.undoSend} />
  <KeyboardShortcutsDialogConnector shortcuts={props.keyboardShortcuts} />
  <div aria-live="polite" className="sr-only">
    {props.keyboardShortcuts.announcement}
  </div>
  </>
  );
};
