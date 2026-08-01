import { describe, expect, it, vi } from "vitest";

import { createMailboxLifecycleViewModel } from "@/presentation/features/mail-workspace/mailbox-lifecycle.view-model";

const model = (overrides: Partial<Parameters<
  typeof createMailboxLifecycleViewModel
>[0]> = {}) => createMailboxLifecycleViewModel({
  activeRole: "trash",
  error: null,
  hasActiveSearch: false,
  isBusy: false,
  isConfirming: false,
  mayRemoveItems: true,
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
  onRequestEmpty: vi.fn(),
  status: "",
  total: 4,
  ...overrides,
});

describe("mailbox lifecycle view model", () => {
  it("exposes provider-neutral Trash retention and irreversible copy", () => {
    expect(model({ isConfirming: true })).toMatchObject({
      confirmation: {
        description: expect.stringContaining("cannot be undone"),
        isOpen: true,
        title: "Empty Trash permanently?",
      },
      disabledReason: null,
      emptyLabel: "Empty Trash",
      retentionHint: expect.stringContaining("mail provider"),
      role: "trash",
    });
  });

  it("uses dedicated Spam copy without claiming fixed retention days", () => {
    const spam = model({ activeRole: "spam" });

    expect(spam.emptyLabel).toBe("Empty Spam");
    expect(spam.retentionHint).toContain("retention policy");
    expect(spam.retentionHint).not.toMatch(/\b\d+\s+days?\b/iu);
  });

  it("blocks emptying during search, cleanup, or an already empty view", () => {
    expect(model({ hasActiveSearch: true }).disabledReason).toContain(
      "Clear the active search",
    );
    expect(model({ isBusy: true }).disabledReason).toContain("cleanup");
    expect(model({ total: 0 }).disabledReason).toBe("Trash is already empty.");
  });

  it("explains when the provider denies permanent removal", () => {
    expect(model({ mayRemoveItems: false }).disabledReason).toContain(
      "does not allow permanently removing",
    );
  });

  it("stays hidden outside Spam and Trash", () => {
    expect(model({ activeRole: "inbox", isConfirming: true })).toMatchObject({
      confirmation: { isOpen: false },
      role: null,
    });
  });
});
