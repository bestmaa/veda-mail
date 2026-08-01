import { PenLine } from "lucide-react";

import { ComposerRecoveryPromptConnector } from "@/presentation/features/mail-workspace/connectors/composer-recovery-prompt.connector";
import { BulkDestroyConfirmationConnector } from "@/presentation/features/mail-workspace/connectors/bulk-destroy-confirmation.connector";
import { MailboxEmptyConfirmationConnector } from "@/presentation/features/mail-workspace/connectors/mailbox-empty-confirmation.connector";
import { ReaderDestroyConfirmationConnector } from "@/presentation/features/mail-workspace/connectors/reader-destroy-confirmation.connector";
import { MemberSignOutConfirmationConnector } from "@/presentation/features/mail-workspace/connectors/member-sign-out-confirmation.connector";
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
    props.labelManagement.isOpen;
  return (
  <>
  <main
    className="h-dvh min-h-[620px] overflow-hidden bg-[#f8f9fc] text-slate-900"
    style={props.branding.brandStyle}
    {...(topLevelModalOpen ? { "aria-hidden": true, inert: true } : {})}
  >
    <MailHeaderView
      account={props.account}
      branding={props.branding}
      navigation={props.navigation}
      onRefresh={props.onRefresh}
      onSearchClear={props.onSearchClear}
      onSearchSubmit={props.onSearchSubmit}
      searchInput={props.searchInput}
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
        isMobileOpen={props.navigation.isOpen}
        mailboxManagement={props.mailboxManagement}
        labelManagement={props.labelManagement}
        onCloseNavigation={props.navigation.onClose}
        onCompose={props.onCompose}
        session={props.session}
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
          mailboxLifecycle={props.mailboxLifecycle}
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
            isMutating={props.isReaderMutating}
            onArchive={props.onArchive}
            onClose={props.onCloseReader}
            onDelete={props.onDelete}
            onForward={props.onForward}
            onReply={props.onReply}
            onReplyAll={props.onReplyAll}
            onRequestDestroy={props.onRequestReaderDestroy}
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
  </main>
  <ComposerRecoveryPromptConnector prompt={props.composer.recoveryPrompt} />
  <BulkDestroyConfirmationConnector bulk={props.bulkActions} />
  <MailboxEmptyConfirmationConnector lifecycle={props.mailboxLifecycle} />
  <ReaderDestroyConfirmationConnector
    confirmation={props.readerDestroyConfirmation}
  />
  <MemberSignOutConfirmationConnector session={props.session} />
  <MailboxManagementView management={props.mailboxManagement} />
  <LabelManagementView management={props.labelManagement} />
  </>
  );
};
