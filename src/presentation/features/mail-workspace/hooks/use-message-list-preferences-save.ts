"use client";

import { useCallback } from "react";

import type { MessageListPreferences } from "@/domain/mail/message-list-preferences";
import type { MailboxId } from "@/domain/shared/brand";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { mailApi } from "@/transport/client/api-client";

interface PreferenceSaveOptions {
  readonly activeMailboxId: MailboxId | null;
  readonly appliedSearch: string;
  readonly commitPreferences: (
    preferences: MessageListPreferences,
    expectedScope: string,
  ) => boolean;
  readonly current: MessageListPreferences | undefined;
  readonly currentScope: () => string;
  readonly handleSessionFailure: MailSessionFailureHandler;
  readonly isCurrentScope: (scope: string) => boolean;
  readonly loadWorkspace: (override: {
    readonly mailboxId: MailboxId | null;
    readonly preferences?: MessageListPreferences;
    readonly search: string;
  }) => Promise<unknown>;
}

export const useMessageListPreferencesSave = ({
  activeMailboxId,
  appliedSearch,
  commitPreferences,
  current,
  currentScope,
  handleSessionFailure,
  isCurrentScope,
  loadWorkspace,
}: PreferenceSaveOptions) => useCallback(async (
  preferences: MessageListPreferences,
) => {
  const requestScope = currentScope();
  if (!requestScope) throw new Error("The mailbox session expired.");
  try {
    const result = await mailApi.saveMessageListPreferences(
      preferences, requestScope,
    );
    if (!isCurrentScope(requestScope)) throw new Error("The mailbox session changed.");
    commitPreferences(result.preferences, requestScope);
    if (
      !current || current.sort !== result.preferences.sort ||
      current.showPreview !== result.preferences.showPreview
    ) {
      await loadWorkspace({
        mailboxId: activeMailboxId,
        preferences: result.preferences,
        search: appliedSearch,
      });
    }
    return result.preferences;
  } catch (error) {
    handleSessionFailure(error);
    throw error;
  }
}, [activeMailboxId, appliedSearch, commitPreferences, current, currentScope,
  handleSessionFailure, isCurrentScope, loadWorkspace]);
