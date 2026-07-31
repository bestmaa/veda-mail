import { describe, expect, it } from "vitest";

import { mapJmapDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.mapper";
import { jmapDraftEmailSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";

const email = (overrides: Readonly<Record<string, unknown>> = {}) =>
  jmapDraftEmailSchema.parse({
    bodyValues: { body: { value: "Safe body" } },
    hasAttachment: false,
    id: "draft",
    keywords: { $draft: true },
    mailboxIds: { drafts: true },
    receivedAt: "2026-07-31T10:00:00.000Z",
    subject: "Subject",
    textBody: [{ partId: "body", type: "text/plain" }],
    ...overrides,
  });

const mapped = (overrides: Readonly<Record<string, unknown>>) =>
  mapJmapDraft(email(overrides), "account", "drafts");

describe("Stalwart draft editing completeness", () => {
  it("blocks body values with provider encoding problems", () => {
    const detail = mapped({
      bodyValues: {
        body: { isEncodingProblem: true, value: "Replacement text" },
      },
    });
    expect(detail.hasTruncatedContent).toBe(true);
  });

  it("blocks aggregate truncation across individually complete parts", () => {
    const first = "a".repeat(128_001);
    const second = "b".repeat(128_001);
    const parsed = email({
      bodyValues: { first: { value: first }, second: { value: second } },
      textBody: [
        { partId: "first", type: "text/plain" },
        { partId: "second", type: "text/plain" },
      ],
    });
    expect(parsed.bodyValuesTruncated).toBe(true);
    expect(mapJmapDraft(parsed, "account", "drafts").hasTruncatedContent).toBe(
      true,
    );
  });

  it("keeps transformed unsafe HTML out of editable draft content", () => {
    const raw = "<p>Safe</p><script>private()</script>";
    const detail = mapped({
      bodyValues: {
        html: { value: raw },
        text: { value: "Safe" },
      },
      htmlBody: [{ partId: "html", type: "text/html" }],
      textBody: [{ partId: "text", type: "text/plain" }],
    });
    expect(detail.content.htmlBody).not.toContain("script");
    expect(detail.hasTruncatedContent).toBe(true);
  });

  it("blocks HTML changed by the safe rendering cap", () => {
    const raw = `<p>${"&".repeat(200_000)}</p>`;
    const parsed = email({
      bodyValues: {
        html: { value: raw },
        text: { value: "Safe" },
      },
      htmlBody: [{ partId: "html", type: "text/html" }],
      textBody: [{ partId: "text", type: "text/plain" }],
    });
    expect(parsed.bodyValuesTruncated).not.toBe(true);
    expect(mapJmapDraft(parsed, "account", "drafts").hasTruncatedContent).toBe(
      true,
    );
  });
});
