import { describe, expect, it } from "vitest";

import { sanitizeMailHtml } from "@/infrastructure/providers/sanitize-mail-html";
import { mapMessageDetail } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.mapper";
import { jmapEmailSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import {
  JMAP_BODY_TRUNCATION_TEXT,
  MAX_JMAP_BODY_VALUE_CHARACTERS,
  MAX_JMAP_BODY_VALUE_PARTS,
  MAX_JMAP_RENDERED_BODY_CHARACTERS,
  type JmapEmail,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const baseEmail: JmapEmail = {
  from: [{ email: "sender@example.com" }],
  hasAttachment: false,
  id: "bounded-message",
  keywords: {},
  mailboxIds: { inbox: true },
  preview: "Preview",
  receivedAt: "2026-07-30T10:00:00.000Z",
  size: 1,
  subject: "Bounded body",
  threadId: "bounded-thread",
  to: [{ email: "recipient@example.com" }],
};

describe("Stalwart JMAP body bounds", () => {
  it("keeps only referenced values within one aggregate budget", () => {
    const parsed = jmapEmailSchema.parse({
      ...baseEmail,
      bodyValues: {
        first: {
          value: "A".repeat(MAX_JMAP_BODY_VALUE_CHARACTERS - 5),
        },
        second: { value: "B".repeat(20) },
        unreferenced: {
          value: "&".repeat(MAX_JMAP_BODY_VALUE_CHARACTERS * 2),
        },
      },
      textBody: [
        { partId: "first", type: "text/plain" },
        { partId: "second", type: "text/plain" },
      ],
    });

    expect(Object.keys(parsed.bodyValues ?? {})).toEqual(["first", "second"]);
    expect(parsed.bodyValues?.["second"]).toEqual({
      isTruncated: true,
      value: "BBBBB",
    });
    expect(
      Object.values(parsed.bodyValues ?? {}).reduce(
        (total, bodyValue) => total + bodyValue.value.length,
        0,
      ),
    ).toBe(MAX_JMAP_BODY_VALUE_CHARACTERS);
    expect(parsed.bodyValuesTruncated).toBe(true);
    expect(mapMessageDetail(parsed).textBody).toContain(
      JMAP_BODY_TRUNCATION_TEXT,
    );
  });

  it("stops retaining values after the bounded part scan", () => {
    const bodyValues = Object.fromEntries(
      Array.from({ length: MAX_JMAP_BODY_VALUE_PARTS + 1 }, (_, index) => [
        `part-${index}`,
        { value: "x" },
      ]),
    );
    const parsed = jmapEmailSchema.parse({
      ...baseEmail,
      bodyValues,
      textBody: Object.keys(bodyValues).map((partId) => ({
        partId,
        type: "text/plain",
      })),
    });

    expect(Object.keys(parsed.bodyValues ?? {})).toHaveLength(
      MAX_JMAP_BODY_VALUE_PARTS,
    );
    expect(parsed.bodyValuesTruncated).toBe(true);
  });

  it("bounds entity expansion and marks hostile multipart truncation", () => {
    const oversized = "&".repeat(MAX_JMAP_BODY_VALUE_CHARACTERS * 2);
    const detail = mapMessageDetail({
      ...baseEmail,
      bodyValues: {
        html: { value: "<p>HTML presentation</p>" },
        plain: { value: oversized },
      },
      htmlBody: [
        { partId: "plain", type: "text/plain" },
        { partId: "html", type: "text/html" },
      ],
      textBody: [{ partId: "plain", type: "text/plain" }],
    });

    expect(detail.textBody.length).toBeLessThanOrEqual(
      MAX_JMAP_RENDERED_BODY_CHARACTERS,
    );
    expect(detail.htmlBody?.length).toBeLessThanOrEqual(
      MAX_JMAP_RENDERED_BODY_CHARACTERS,
    );
    expect(detail.textBody).toContain(JMAP_BODY_TRUNCATION_TEXT);
    expect(detail.htmlBody).toContain(JMAP_BODY_TRUNCATION_TEXT);
    expect(detail.htmlBody).toContain("&amp;");
    expect(detail.htmlBody).toBe(
      sanitizeMailHtml(detail.htmlBody ?? ""),
    );
  });

  it("returns valid marked HTML when the source cap cuts markup or an entity", () => {
    const detail = mapMessageDetail({
      ...baseEmail,
      bodyValues: {
        html: {
          value: `<div>${"&amp;".repeat(
            MAX_JMAP_BODY_VALUE_CHARACTERS,
          )}<strong title="cut`,
        },
      },
      htmlBody: [{ partId: "html", type: "text/html" }],
    });
    const html = detail.htmlBody ?? "";

    expect(html.length).toBeLessThanOrEqual(
      MAX_JMAP_RENDERED_BODY_CHARACTERS,
    );
    expect(html).toContain(JMAP_BODY_TRUNCATION_TEXT);
    expect(html).toBe(sanitizeMailHtml(html));
  });
});
