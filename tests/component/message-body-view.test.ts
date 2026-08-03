import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MessageBodyConnector } from "@/presentation/features/mail-workspace/connectors/message-body.connector";

const renderBody = (body: string, htmlBody: string | null) =>
  renderToStaticMarkup(createElement(MessageBodyConnector, {
    body,
    handleSessionFailure: () => false,
    htmlBody,
    messageId: "message-one",
    sessionScope: "scope-one",
  }));

describe("message body quote controls", () => {
  it("starts a plain-text reply with the quoted history collapsed", () => {
    const html = renderBody(
      "Current answer\n\nOn 3 Aug 2026, Ada wrote:\n> Earlier answer",
      null,
    );

    expect(html).toContain("Current answer");
    expect(html).not.toContain("Earlier answer");
    expect(html).toContain("Show quoted content");
    expect(html).toContain('aria-expanded="false"');
  });

  it("keeps sanitized HTML in its sandbox and collapses blockquotes", () => {
    const html = renderBody("Current answer", "<p>Current answer</p><blockquote>Earlier</blockquote>");

    expect(html).toContain('sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"');
    expect(html).toContain("veda-collapse-quotes");
    expect(html).toContain("Show quoted content");
  });

  it("does not show a disclosure control when no quote exists", () => {
    expect(renderBody("Only current text", null)).not.toContain(
      "Show quoted content",
    );
  });
});
