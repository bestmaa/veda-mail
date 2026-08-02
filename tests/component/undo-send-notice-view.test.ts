import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { UndoSendNoticeView } from "@/presentation/features/mail-workspace/ui/undo-send-notice.view";

describe("undo-send notice", () => {
  it("announces an honest countdown and offers undo", () => {
    const html = renderToStaticMarkup(createElement(UndoSendNoticeView, {
      undo: {
        error: null, isUndoing: false, isVisible: true,
        onDismiss: vi.fn(), onUndo: vi.fn(), secondsRemaining: 9,
        subject: "Quarterly update",
      },
    }));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Message queued: Quarterly update");
    expect(html).toContain("Undo available for 9 seconds.");
    expect(html).toContain(">Undo</button>");
  });

  it("keeps a too-late cancellation error visible", () => {
    const html = renderToStaticMarkup(createElement(UndoSendNoticeView, {
      undo: {
        error: "This message is already being sent.", isUndoing: false,
        isVisible: true, onDismiss: vi.fn(), onUndo: vi.fn(),
        secondsRemaining: 0, subject: "Already claimed",
      },
    }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("already being sent");
  });
});
