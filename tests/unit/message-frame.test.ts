import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildSanitizedMessageDocument,
  isMessageFrameEventData,
  MESSAGE_FRAME_EVENT,
  MESSAGE_RESIZE_SCRIPT,
  MESSAGE_RESIZE_SCRIPT_HASH,
} from "@/presentation/features/mail-workspace/message-frame";

describe("sanitized message frame", () => {
  it("allows only the trusted resize script", () => {
    const actualHash = createHash("sha256")
      .update(MESSAGE_RESIZE_SCRIPT)
      .digest("base64");

    expect(actualHash).toBe(MESSAGE_RESIZE_SCRIPT_HASH);
    expect(buildSanitizedMessageDocument("<p>Hello</p>")).toContain(
      `script-src 'sha256-${actualHash}'`,
    );
  });

  it("adds readable base styles without relaxing network access", () => {
    const document = buildSanitizedMessageDocument(
      "<ol><li>First</li><li>Second</li></ol>",
    );

    expect(document).toContain("default-src 'none'");
    expect(document).toContain("font-family:-apple-system");
    expect(document).toContain("ul,ol{padding-inline-start:1.6em}");
    expect(document).toContain("overflow-wrap:anywhere");
    expect(document).toContain("pre{font:inherit;white-space:pre-wrap}");
    expect(document).toContain(
      "code,pre code{font-family:ui-monospace",
    );
    expect(document).toContain(
      "<ol><li>First</li><li>Second</li></ol>",
    );
  });

  it("accepts only finite resize messages with the expected type", () => {
    expect(
      isMessageFrameEventData({
        height: 640,
        type: MESSAGE_FRAME_EVENT,
      }),
    ).toBe(true);
    expect(
      isMessageFrameEventData({ height: Number.POSITIVE_INFINITY }),
    ).toBe(false);
    expect(isMessageFrameEventData({ height: "640" })).toBe(false);
  });
});
