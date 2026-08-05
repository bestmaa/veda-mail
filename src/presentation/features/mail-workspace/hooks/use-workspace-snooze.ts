"use client";

import type { Mailbox } from "@/domain/mail/mail";
import type { MailLocalization } from "@/presentation/features/mail-workspace/hooks/use-mail-localization";
import type { useMailDataModel } from "@/presentation/features/mail-workspace/hooks/use-mail-data-model";
import { useMailSnoozeModel } from "@/presentation/features/mail-workspace/hooks/use-mail-snooze-model";

export const useWorkspaceSnooze = (
  mail: ReturnType<typeof useMailDataModel>,
  activeMailbox: Mailbox | null,
  localization: MailLocalization,
) => useMailSnoozeModel({
  activeMailbox: activeMailbox ? { id: activeMailbox.id, role: activeMailbox.role } : null,
  beginOptimistic: mail.snoozeOptimistic.begin,
  handleSessionFailure: mail.handleSessionFailure,
  markUnconfirmed: mail.snoozeOptimistic.markUnconfirmed,
  locale: localization.locale,
  messages: mail.workspace?.messages.items ?? [],
  pendingMessageIds: mail.pendingMessageIds,
  refresh: mail.refresh,
  selectedIds: mail.bulk.selectedIds,
  selectedMessage: mail.selectedMessage,
  sessionScope: mail.sessionScope,
  timeZone: localization.timeZone,
  settleOptimistic: mail.snoozeOptimistic.settle,
});
