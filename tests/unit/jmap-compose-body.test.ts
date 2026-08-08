import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  jmapComposeBody,
  uploadVerifiedJmapAttachments,
} from "@/infrastructure/providers/stalwart-jmap/jmap-compose-attachments";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";

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
          size: 42,
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

  it("marks canonical calendar replies as inline METHOD=REPLY parts", () => {
    const result = jmapComposeBody("Accepted.", undefined, [{
      blobId: "calendar-blob",
      calendarMethod: "REPLY",
      name: "reply.ics",
      size: 42,
      type: "text/calendar",
    }]);

    expect(result).toMatchObject({
      bodyStructure: {
        subParts: [
          { partId: "body", type: "text/plain" },
          {
            blobId: "calendar-blob",
            disposition: "inline",
            "header:Content-Type":
              "text/calendar; method=REPLY; charset=utf-8",
            name: "reply.ics",
            type: "text/calendar",
          },
        ],
        type: "multipart/mixed",
      },
    });
  });

  it("rejects a calendar marker on non-calendar bytes before upload", async () => {
    const content = Buffer.from("not a calendar", "utf8");
    const client = {
      uploadAttachment: vi.fn(),
    } as unknown as StalwartJmapClient;

    await expect(uploadVerifiedJmapAttachments(client, "account", {
      attachments: [{
        calendarMethod: "REPLY",
        content,
        id: id.attachmentUpload("bad-calendar"),
        mimeType: "application/octet-stream",
        name: "reply.ics",
        sha256: createHash("sha256").update(content).digest("hex"),
        size: content.byteLength,
      }],
      bcc: [], body: "Reply", cc: [], subject: "Reply", to: [],
    })).rejects.toThrow("calendar reply media type");
    expect(client.uploadAttachment).not.toHaveBeenCalled();
  });
});
