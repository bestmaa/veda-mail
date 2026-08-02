import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { KeyboardShortcutsDialogView } from "@/presentation/features/mail-workspace/ui/keyboard-shortcuts-dialog.view";

const render = (enabled: boolean) => renderToStaticMarkup(createElement(
  KeyboardShortcutsDialogView,
  { dialog: { enabled, isOpen: true, onClose: vi.fn() } },
));

describe("keyboard shortcut guide", () => {
  it("exposes a labelled modal and every supported command", () => {
    const html = render(true);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Shortcuts are enabled for this account.");
    for (const label of [
      "Focus mail search", "Compose a new message", "Archive the open message",
      "Reply all", "Single-key shortcuts are suspended while you type",
    ]) expect(html).toContain(label);
  });

  it("truthfully reports when commands are disabled", () => {
    expect(render(false)).toContain(
      "Shortcuts are off. Enable them in Mailbox preferences.",
    );
  });
});
