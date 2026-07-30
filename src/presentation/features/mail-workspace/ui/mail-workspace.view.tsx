import { PenLine } from "lucide-react";

import type { MailWorkspaceViewProps } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { AccountSettingsView } from "@/presentation/features/mail-workspace/ui/account-settings.view";
import { ComposerView } from "@/presentation/features/mail-workspace/ui/composer.view";
import { EmptyReaderView } from "@/presentation/features/mail-workspace/ui/empty-reader.view";
import { MailHeaderView } from "@/presentation/features/mail-workspace/ui/mail-header.view";
import { MailSidebarView } from "@/presentation/features/mail-workspace/ui/mail-sidebar.view";
import { MessageListView } from "@/presentation/features/mail-workspace/ui/message-list.view";
import { MessageReaderView } from "@/presentation/features/mail-workspace/ui/message-reader.view";
import { PartialDeliveryNoticeView } from "@/presentation/features/mail-workspace/ui/partial-delivery-notice.view";

export const MailWorkspaceView = (props: MailWorkspaceViewProps) => (
  <main className="h-dvh min-h-[620px] overflow-hidden bg-[#f8f9fc] text-slate-900" style={props.branding.brandStyle}>
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
        isMobileOpen={props.navigation.isOpen}
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
          error={props.error}
          isLoading={props.isLoading}
          messages={props.messages}
          total={props.total}
        />
      </div>
      <div
        className={`min-h-0 ${props.reader ? "block" : "hidden lg:block"}`}
      >
        {props.reader ? (
          <MessageReaderView
            onArchive={props.onArchive}
            onClose={props.onCloseReader}
            onDelete={props.onDelete}
            onForward={props.onForward}
            onReply={props.onReply}
            onReplyAll={props.onReplyAll}
            onToggleRead={props.onToggleRead}
            onToggleStar={props.onToggleStar}
            reader={props.reader}
          />
        ) : (
          <EmptyReaderView onCompose={props.onCompose} />
        )}
      </div>
    </div>

    <button
      aria-label="Compose a new message"
      className="fixed bottom-5 right-5 z-30 grid size-14 place-items-center rounded-2xl bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)] shadow-xl md:hidden"
      onClick={props.onCompose}
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
);
