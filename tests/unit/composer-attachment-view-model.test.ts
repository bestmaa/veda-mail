import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { createComposerAttachmentViewModel } from "@/presentation/features/mail-workspace/composer-attachment.view-model";
import type { ComposerAttachment } from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";

const imported = (
  overrides: Partial<ComposerAttachment> = {},
): ComposerAttachment => ({
  error: null,
  key: "forwarded-key",
  name: "roadmap.pdf",
  size: 51,
  source: {
    attachmentId: id.attachment("opaque-attachment"),
    messageId: id.message("opaque-message"),
  },
  state: "uploading",
  upload: null,
  ...overrides,
});

describe("composer attachment view model", () => {
  it("labels an original copy and exposes scoped retry/remove actions", () => {
    const remove = vi.fn();
    const retry = vi.fn();
    const model = createComposerAttachmentViewModel(
      imported(),
      remove,
      retry,
    );

    expect(model.meta).toBe("51 B · Copying and scanning…");
    model.onRetry?.();
    model.onRemove();
    expect(retry).toHaveBeenCalledWith("forwarded-key");
    expect(remove).toHaveBeenCalledWith("forwarded-key");
  });

  it("distinguishes original copy failures from manual upload failures", () => {
    const importedFailure = createComposerAttachmentViewModel(
      imported({ error: "Too large.", state: "error" }),
      vi.fn(),
      vi.fn(),
    );
    const manualFailure = createComposerAttachmentViewModel(
      {
        error: "Malware detected.",
        key: "manual-key",
        name: "manual.exe",
        size: 10,
        state: "error",
        upload: null,
      },
      vi.fn(),
      vi.fn(),
    );

    expect(importedFailure.meta).toBe("51 B · Copy failed");
    expect(importedFailure.onRetry).toBeTypeOf("function");
    expect(manualFailure.meta).toBe("10 B · Upload failed");
    expect(manualFailure.onRetry).toBeUndefined();
  });
});
