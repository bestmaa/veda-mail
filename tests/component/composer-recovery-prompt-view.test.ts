import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComposerRecoveryPromptView } from "@/presentation/features/mail-workspace/ui/composer-recovery-prompt.view";

const prompt = {
  description: "A send may have completed. Check Sent first.",
  error: null,
  hadLocalAttachments: false,
  initialFocus: "secondary" as const,
  isLoading: false,
  isOpen: true,
  onDismiss: vi.fn(),
  onPrimary: vi.fn(),
  onSecondary: vi.fn(),
  primaryLabel: "Review copy safely",
  secondaryLabel: "Not now",
  title: "Check Sent before continuing",
};

describe("composer recovery prompt", () => {
  it("renders terminal-safe copy and supplied explicit actions", () => {
    const html = renderToStaticMarkup(createElement(
      ComposerRecoveryPromptView, { prompt },
    ));
    expect(html).toContain("Check Sent before continuing");
    expect(html).toContain("A send may have completed. Check Sent first.");
    expect(html).toContain("Review copy safely");
    expect(html).toContain("Not now");
    expect(html).toContain('id="composer-recovery-dialog"');
    expect(html).toContain('id="composer-recovery-secondary"');
    expect(html).toContain('id="composer-recovery-primary"');
    expect(html).not.toContain("autofocus");
    expect(html).not.toContain("Restore interrupted draft?");
  });
});
