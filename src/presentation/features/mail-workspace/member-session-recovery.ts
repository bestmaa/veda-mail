"use client";

import { browserComposerRecoveryDatabase } from "@/presentation/features/mail-workspace/composer-recovery-database";
import {
  browserComposerRecoveryStorage,
  type ComposerRecoveryStorage,
} from "@/presentation/features/mail-workspace/composer-recovery-storage";
import { publishMemberSessionRevocation } from "@/presentation/features/mail-workspace/member-session-revocation";

export const MEMBER_SESSION_RECOVERY_PURGE_ERROR =
  "Private draft recovery data could not be removed. Retry secure cleanup or clear this site’s browser data before leaving this device.";

export type MemberSessionRecoveryPurger = (
  sessionScope: string,
) => Promise<void>;
type RecoveryPurgeFailureHandler = (message: string) => void;

type RecoveryScopeStorage = Pick<ComposerRecoveryStorage, "purgeScope">;

export const purgeMemberSessionRecovery = async (
  sessionScope: string,
  storage: RecoveryScopeStorage | null = browserComposerRecoveryStorage(),
  durableFallback: RecoveryScopeStorage | null = browserComposerRecoveryDatabase(),
): Promise<void> => {
  if (!sessionScope) {
    throw new Error(MEMBER_SESSION_RECOVERY_PURGE_ERROR);
  }
  const primary = storage ?? durableFallback;
  if (!primary) return;

  try {
    await primary.purgeScope(sessionScope);
  } catch (cause) {
    if (durableFallback && durableFallback !== primary) {
      try {
        await durableFallback.purgeScope(sessionScope);
        return;
      } catch (fallbackCause) {
        throw new Error(MEMBER_SESSION_RECOVERY_PURGE_ERROR, {
          cause: fallbackCause,
        });
      }
    }
    throw new Error(MEMBER_SESSION_RECOVERY_PURGE_ERROR, { cause });
  }
};

export const purgeInvalidatedSessionRecovery = (
  sessionScope: string,
  onFailure: RecoveryPurgeFailureHandler,
  purgeRecovery: MemberSessionRecoveryPurger = purgeMemberSessionRecovery,
): void => {
  if (!sessionScope) return;
  let cleanup: Promise<void>;
  try {
    cleanup = purgeRecovery(sessionScope);
  } catch {
    onFailure(MEMBER_SESSION_RECOVERY_PURGE_ERROR);
    return;
  }
  publishMemberSessionRevocation(sessionScope, "invalidated");
  void cleanup.catch(() =>
    onFailure(MEMBER_SESSION_RECOVERY_PURGE_ERROR));
};
