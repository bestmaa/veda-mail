import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { clearAttachedComposerSignatureSelection } from "@/presentation/features/mail-workspace/composer-signature-selection";

describe("composer signature rich/plain lifecycle", () => {
  it("clears the attached id while retaining already-flattened body text", () => {
    const onSelectedIdChange = vi.fn();
    const flattenedBody = "Hello\n\nRegards,\nAda";

    clearAttachedComposerSignatureSelection(
      id.signature("work"),
      onSelectedIdChange,
    );

    expect(flattenedBody).toContain("Regards,\nAda");
    expect(onSelectedIdChange).toHaveBeenCalledOnce();
    expect(onSelectedIdChange).toHaveBeenCalledWith(null);
  });

  it("does not emit a redundant clear for an existing None slot", () => {
    const onSelectedIdChange = vi.fn();

    clearAttachedComposerSignatureSelection(null, onSelectedIdChange);

    expect(onSelectedIdChange).not.toHaveBeenCalled();
  });
});
