import { describe, expect, it } from "vitest";

import { shouldBlockComposerUnload } from "@/presentation/features/mail-workspace/hooks/use-composer-page-lifecycle";

const state = {
  hasDurableIntent: true,
  hasLocalAttachments: false,
  isOpen: true,
  localCheckpointCurrent: false,
};

describe("composer page lifecycle", () => {
  it("warns only while intended content has no complete durable recovery", () => {
    expect(shouldBlockComposerUnload(state)).toBe(true);
    expect(shouldBlockComposerUnload({
      ...state, localCheckpointCurrent: true,
    })).toBe(false);
    expect(shouldBlockComposerUnload({
      ...state, hasDurableIntent: false,
    })).toBe(false);
    expect(shouldBlockComposerUnload({ ...state, isOpen: false })).toBe(false);
  });

  it("keeps warning for local attachments because their bytes are not restorable", () => {
    expect(shouldBlockComposerUnload({
      ...state,
      hasLocalAttachments: true,
      localCheckpointCurrent: true,
    })).toBe(true);
  });
});
