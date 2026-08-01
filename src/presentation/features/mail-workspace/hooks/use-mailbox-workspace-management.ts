"use client";

import type { useMailDataModel } from "@/presentation/features/mail-workspace/hooks/use-mail-data-model";
import { useMailboxManagement } from "@/presentation/features/mail-workspace/hooks/use-mailbox-management";

export const useMailboxWorkspaceManagement = (
  mail: ReturnType<typeof useMailDataModel>,
) => useMailboxManagement({
  activeMailboxId: mail.activeMailboxId,
  handleSessionFailure: mail.handleSessionFailure,
  mailboxes: mail.workspace?.mailboxes ?? [],
  refresh: mail.refresh,
  selectMailbox: mail.selectMailbox,
  sessionScope: mail.workspace?.sessionScope ?? "",
});
