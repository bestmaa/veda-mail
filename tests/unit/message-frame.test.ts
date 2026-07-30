import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildSanitizedMessageDocument,
  createMessageFrameRenderId,
  isMessageFrameEventData,
  messageFrameInlineImageRetryIds,
  MESSAGE_FRAME_EVENT,
  MESSAGE_FRAME_STYLE_HASH,
  MESSAGE_FRAME_STYLES,
  MESSAGE_RESIZE_SCRIPT,
  MESSAGE_RESIZE_SCRIPT_HASH,
  settleMessageFrameInlineImageFailures,
} from "@/presentation/features/mail-workspace/message-frame";

const directiveSources = (policy: string, name: string): string[] =>
  policy
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith(`${name} `))
    ?.split(/\s+/u)
    .slice(1) ?? [];

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
    const actualStyleHash = createHash("sha256")
      .update(MESSAGE_FRAME_STYLES)
      .digest("base64");
    const document = buildSanitizedMessageDocument(
      "<ol><li>First</li><li>Second</li></ol>",
    );

    expect(actualStyleHash).toBe(MESSAGE_FRAME_STYLE_HASH);
    expect(document).toContain(`style-src 'sha256-${actualStyleHash}'`);
    expect(document).toContain("style-src-attr 'none'");
    expect(document).not.toContain("style-src 'unsafe-inline'");
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

  it("permits only blob-backed child images without network access", () => {
    const document = buildSanitizedMessageDocument(
      '<img data-veda-inline-image="attachment-1">',
    );
    const policy =
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u.exec(
        document,
      )?.[1] ?? "";
    const imageSources = directiveSources(policy, "img-src");

    expect(directiveSources(policy, "connect-src")).toEqual(["'none'"]);
    expect(imageSources).toEqual(["blob:"]);
    expect(imageSources).not.toContain("data:");
    expect(imageSources).not.toContain("'self'");
    expect(imageSources).not.toContain("http:");
    expect(imageSources).not.toContain("https:");
  });

  it("accepts only finite resize messages with the expected type", () => {
    expect(
      isMessageFrameEventData({
        height: 640,
        renderId: "current-render",
        type: MESSAGE_FRAME_EVENT,
      }, "current-render"),
    ).toBe(true);
    expect(isMessageFrameEventData({
      height: 640,
      renderId: "stale-render",
      type: MESSAGE_FRAME_EVENT,
    }, "current-render")).toBe(false);
    expect(isMessageFrameEventData({
      height: Number.POSITIVE_INFINITY,
      renderId: "current-render",
      type: MESSAGE_FRAME_EVENT,
    })).toBe(false);
    expect(isMessageFrameEventData({
      height: "640",
      renderId: "current-render",
      type: MESSAGE_FRAME_EVENT,
    })).toBe(false);
  });

  it("creates a compact render identity for every document revision", () => {
    const first = createMessageFrameRenderId(
      "m".repeat(2_048),
      "<p>First</p>",
    );
    const second = createMessageFrameRenderId(
      "m".repeat(2_048),
      "<p>Second</p>",
    );

    expect(first).not.toBe(second);
    expect(first.length).toBeLessThan(64);
    expect(
      buildSanitizedMessageDocument("<p>First</p>", first),
    ).toContain(`data-veda-render-id="${first}"`);
  });

  it("retries only failed IDs for the current render and clears successes", () => {
    const initial = settleMessageFrameInlineImageFailures(
      { attachmentIds: [], renderId: "" },
      "current-render",
      ["loaded", "failed"],
      new Set(["failed"]),
    );

    expect(
      messageFrameInlineImageRetryIds(initial, "current-render"),
    ).toEqual(["failed"]);
    expect(
      messageFrameInlineImageRetryIds(initial, "stale-render"),
    ).toEqual([]);

    const retried = settleMessageFrameInlineImageFailures(
      initial,
      "current-render",
      ["failed"],
      new Set(),
    );
    expect(
      messageFrameInlineImageRetryIds(retried, "current-render"),
    ).toEqual([]);
  });
});
