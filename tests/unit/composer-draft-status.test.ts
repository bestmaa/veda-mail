import { describe, expect, it } from "vitest";

import { createComposerDraftStatus } from "@/presentation/features/mail-workspace/composer-draft-status";

const input = {
  autosave: {
    isOnline: true,
    nextAttemptAt: null,
    phase: "scheduled" as const,
    retryAttempt: 0,
  },
  enabled: true,
  hasLocalAttachments: false,
  hasUserEdits: true,
  localCheckpointCurrent: false,
  phase: "unsaved" as const,
  storageError: null,
};

describe("composer draft status", () => {
  it("distinguishes mailbox, local, scheduled, and offline durability", () => {
    expect(createComposerDraftStatus(input)?.label).toBe("Saving soon…");
    expect(createComposerDraftStatus({
      ...input, localCheckpointCurrent: true,
    })?.label).toBe("Saved locally");
    expect(createComposerDraftStatus({
      ...input,
      autosave: { ...input.autosave, isOnline: false, phase: "offline" },
      localCheckpointCurrent: true,
    })?.label).toBe("Offline · saved on this device");
    expect(createComposerDraftStatus({
      ...input, hasUserEdits: false, phase: "saved",
    })?.label).toBe("Saved");
  });

  it("never claims local attachments themselves are recoverable", () => {
    const value = createComposerDraftStatus({
      ...input, hasLocalAttachments: true, localCheckpointCurrent: true,
    });
    expect(value?.label).toContain("attachments stay in this tab");
    expect(value?.announcement).toContain("Attachments stay only in this tab");
  });

  it("prioritizes storage and conflict failures", () => {
    expect(createComposerDraftStatus({
      ...input, storageError: "unavailable",
    })?.label).toBe("Recovery unavailable");
    expect(createComposerDraftStatus({
      ...input, phase: "conflict",
    })?.label).toBe("Needs attention");
    expect(createComposerDraftStatus({ ...input, enabled: false })).toBeNull();
  });
});
