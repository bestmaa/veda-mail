import type { ComposerAutosaveStatus } from "@/presentation/features/mail-workspace/composer-autosave.types";
import type { ComposerDraftPhase } from "@/presentation/features/mail-workspace/composer-draft-state";

export interface ComposerDraftStatus {
  readonly announcement: string;
  readonly label: string;
  readonly tone: "danger" | "muted" | "warning";
}

interface ComposerDraftStatusInput {
  readonly autosave: ComposerAutosaveStatus;
  readonly enabled: boolean;
  readonly hasLocalAttachments: boolean;
  readonly hasUserEdits: boolean;
  readonly localCheckpointCurrent: boolean;
  readonly phase: ComposerDraftPhase;
  readonly storageError: string | null;
}

const status = (
  label: string,
  tone: ComposerDraftStatus["tone"] = "muted",
  announcement = label,
): ComposerDraftStatus => ({ announcement, label, tone });

export const createComposerDraftStatus = ({
  autosave,
  enabled,
  hasLocalAttachments,
  hasUserEdits,
  localCheckpointCurrent,
  phase,
  storageError,
}: ComposerDraftStatusInput): ComposerDraftStatus | null => {
  if (!enabled) return null;
  if (storageError) return status(
    "Recovery unavailable",
    "danger",
    "Draft recovery is unavailable. Keep this tab open and retry.",
  );
  if (phase === "conflict" || autosave.phase === "blocked") {
    return status("Needs attention", "danger", "Draft saving needs attention.");
  }
  if (hasLocalAttachments) return localCheckpointCurrent
    ? status(
        "Saved locally · attachments stay in this tab",
        "warning",
        "Message changes are saved locally. Attachments stay only in this tab.",
      )
    : status(
        "Saving locally · attachments stay in this tab",
        "warning",
        "Saving message recovery locally. Attachments stay only in this tab.",
      );
  if (hasUserEdits && !autosave.isOnline) return localCheckpointCurrent
    ? status("Offline · saved on this device", "warning")
    : status("Offline · recovery pending", "danger");
  if (phase === "saving" || autosave.phase === "saving") {
    return status("Saving…");
  }
  if (autosave.phase === "backoff") {
    return status("Retrying save…", "warning");
  }
  if (phase === "saved" && !hasUserEdits) return status("Saved");
  if (hasUserEdits && localCheckpointCurrent) return status("Saved locally");
  if (autosave.phase === "scheduled") return status("Saving soon…");
  return status("Unsaved", phase === "error" ? "danger" : "muted");
};
