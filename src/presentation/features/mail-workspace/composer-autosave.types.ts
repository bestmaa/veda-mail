import type { ComposerDraftRetryKind } from "@/presentation/features/mail-workspace/composer-draft-state";

export const COMPOSER_AUTOSAVE_IDLE_MS = 2_000;
export const COMPOSER_AUTOSAVE_MAX_WAIT_MS = 15_000;
export const COMPOSER_AUTOSAVE_RETRY_BASE_MS = 2_000;
export const COMPOSER_AUTOSAVE_RETRY_MAX_MS = 30_000;

export type ComposerAutosavePhase =
  | "attachments"
  | "backoff"
  | "blocked"
  | "disabled"
  | "idle"
  | "offline"
  | "paused"
  | "saving"
  | "scheduled";

export interface ComposerAutosaveStatus {
  readonly isOnline: boolean;
  readonly nextAttemptAt: number | null;
  readonly phase: ComposerAutosavePhase;
  readonly retryAttempt: number;
}

export interface ComposerAutosaveInput {
  readonly autosave: () => Promise<boolean>;
  readonly contentGeneration: number;
  readonly enabled: boolean;
  readonly hasLocalAttachments: boolean;
  readonly hasUserEdits: boolean;
  readonly paused: boolean;
  readonly reconcile: () => Promise<boolean>;
  readonly retryKind: ComposerDraftRetryKind;
}

export interface ComposerAutosaveClock {
  readonly clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  readonly now: () => number;
  readonly setTimeout: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
}

export const composerAutosaveBrowserClock: ComposerAutosaveClock = {
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
};

export const composerAutosaveRetryDelay = (attempt: number): number =>
  Math.min(
    COMPOSER_AUTOSAVE_RETRY_MAX_MS,
    COMPOSER_AUTOSAVE_RETRY_BASE_MS * (2 ** Math.max(0, attempt - 1)),
  );

export const isComposerAutosaveRetryable = (
  kind: ComposerDraftRetryKind,
): boolean => kind === "backoff" || kind === "reconcile";

export const canComposerAutosaveRun = (
  input: ComposerAutosaveInput,
  isOnline: boolean,
  retryKind: ComposerDraftRetryKind,
): boolean => input.enabled && isOnline && !input.paused &&
  !input.hasLocalAttachments && retryKind !== "blocked";
