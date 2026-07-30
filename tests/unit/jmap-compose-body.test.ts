import { describe, expect, it } from "vitest";

import { jmapComposeBody } from "@/infrastructure/providers/stalwart-jmap/jmap-compose-attachments";

describe("JMAP compose body", () => {
  it("preserves the legacy textBody representation for plain messages", () => {
    expect(jmapComposeBody("Plain body", undefined, [])).toEqual({
      bodyValues: { body: { value: "Plain body" } },
      textBody: [{ partId: "body", type: "text/plain" }],
    });
  });

  it("uses matching textBody and htmlBody parts without attachments", () => {
    const result = jmapComposeBody(
      "Readable fallback",
      "<p><strong>Rich</strong> body</p>",
      [],
    );

    expect(result).toEqual({
      bodyValues: {
        html: { value: "<p><strong>Rich</strong> body</p>" },
        text: { value: "Readable fallback" },
      },
      htmlBody: [{ partId: "html", type: "text/html" }],
      textBody: [{ partId: "text", type: "text/plain" }],
    });
    expect(result).not.toHaveProperty("bodyStructure");
    expect(result).not.toHaveProperty("attachments");
  });

  it("nests rich alternatives inside multipart/mixed before blob parts", () => {
    const result = jmapComposeBody(
      "Readable fallback",
      "<p><strong>Rich</strong> body</p>",
      [
        {
          blobId: "provider-blob",
          name: "evidence.bin",
          type: "application/octet-stream",
        },
      ],
    );

    expect(result).toEqual({
      bodyStructure: {
        subParts: [
          {
            subParts: [
              { partId: "text", type: "text/plain" },
              { partId: "html", type: "text/html" },
            ],
            type: "multipart/alternative",
          },
          {
            blobId: "provider-blob",
            disposition: "attachment",
            name: "evidence.bin",
            type: "application/octet-stream",
          },
        ],
        type: "multipart/mixed",
      },
      bodyValues: {
        html: { value: "<p><strong>Rich</strong> body</p>" },
        text: { value: "Readable fallback" },
      },
    });
    expect(result).not.toHaveProperty("textBody");
    expect(result).not.toHaveProperty("htmlBody");
    expect(result).not.toHaveProperty("attachments");
  });
});
