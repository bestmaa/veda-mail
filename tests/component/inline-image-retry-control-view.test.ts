import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MessageFrameConnector } from "@/presentation/features/mail-workspace/connectors/message-frame.connector";
import { InlineImageRetryControlView } from "@/presentation/features/mail-workspace/ui/inline-image-retry-control.view";

const render = (failedCount: number, isRetrying = false): string =>
  renderToStaticMarkup(
    createElement(InlineImageRetryControlView, {
      failedCount,
      isRetrying,
      onRetry: () => undefined,
    }),
  );

describe("inline image retry control", () => {
  it("remounts retry state across an A to B to same-A revisit", () => {
    const render = (messageId: string, sanitizedHtml: string) =>
      MessageFrameConnector({
        handleSessionFailure: () => false,
        messageId,
        sanitizedHtml,
        sessionScope: "scope-a",
      });
    const firstA = render("message-a", "<p>Message A</p>");
    const messageB = render("message-b", "<p>Message B</p>");
    const revisitedA = render("message-a", "<p>Message A</p>");

    expect(firstA.key).not.toBe(messageB.key);
    expect(messageB.key).not.toBe(revisitedA.key);
    expect(revisitedA.key).toBe(firstA.key);
  });

  it("offers a keyboard-accessible manual retry after terminal failures", () => {
    const html = render(2);

    expect(html).toContain('role="status"');
    expect(html).toContain("2 embedded images could not be loaded.");
    expect(html).toContain('aria-label="Retry embedded images"');
    expect(html).toContain('type="button"');
    expect(html).toContain("focus-visible:outline-indigo-600");
    expect(html).not.toContain(' disabled=""');
  });

  it("shows retry progress and disappears after all failures clear", () => {
    const retrying = render(1, true);

    expect(retrying).toContain("An embedded image could not be loaded.");
    expect(retrying).toContain('aria-label="Retrying embedded images"');
    expect(retrying).toContain(' disabled=""');
    expect(render(0)).toBe("");
  });
});
