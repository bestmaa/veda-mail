import { describe, expect, it } from "vitest";

import {
  bindJmapReceivedAttachments,
  readJmapReceivedAttachmentProviderBlobId,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-attachment";
import { jmapInlineImageCandidates } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-inline-image";
import type { JmapEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const email = (
  overrides: Partial<JmapEmail> = {},
): Pick<JmapEmail, "attachments" | "htmlBody" | "id"> => ({
  attachments: [],
  htmlBody: [],
  id: "message-one",
  ...overrides,
});

describe("Stalwart received attachment binding", () => {
  it("deterministically unions attachments with eligible HTML body media", () => {
    const attachments = bindJmapReceivedAttachments(
      "account-one",
      email({
        attachments: [
          {
            blobId: "document-blob",
            disposition: "attachment",
            name: "report.pdf",
            partId: "part-document",
            size: null,
            type: "application/pdf",
          },
          {
            blobId: "shared-image-blob",
            cid: "shared@example.test",
            disposition: "inline",
            name: "shared.png",
            partId: "part-shared",
            size: 12,
            type: "image/png",
          },
        ],
        htmlBody: [
          { partId: "html", size: 20, type: "text/html" },
          {
            blobId: "shared-image-blob",
            cid: "shared@example.test",
            disposition: "inline",
            name: "shared.png",
            partId: "part-shared",
            size: 12,
            type: "image/png",
          },
          {
            blobId: "inline-image-blob",
            cid: "<Logo%40Example.TEST>",
            name: "logo.png",
            partId: "part-logo",
            size: 8,
            type: "IMAGE/PNG",
          },
          {
            blobId: "untrusted-application-blob",
            partId: "part-application",
            size: 4,
            type: "application/javascript",
          },
        ],
      }),
    );

    expect(attachments.map(({ metadata }) => metadata)).toMatchObject([
      {
        disposition: "attachment",
        mimeType: "application/pdf",
        name: "report.pdf",
        size: null,
      },
      {
        disposition: "inline",
        mimeType: "image/png",
        name: "shared.png",
        size: 12,
      },
      {
        disposition: "inline",
        mimeType: "image/png",
        name: "logo.png",
        size: 8,
      },
    ]);
    expect(attachments[2]?.contentId).toBe("Logo%40Example.TEST");
    expect(attachments.map(({ metadata }) => metadata.id)).toEqual(
      bindJmapReceivedAttachments(
        "account-one",
        email({
          attachments: [
            {
              blobId: "document-blob",
              disposition: "attachment",
              name: "report.pdf",
              partId: "part-document",
              size: null,
              type: "application/pdf",
            },
            {
              blobId: "shared-image-blob",
              cid: "shared@example.test",
              disposition: "inline",
              name: "shared.png",
              partId: "part-shared",
              size: 12,
              type: "image/png",
            },
          ],
          htmlBody: [
            { partId: "html", size: 20, type: "text/html" },
            {
              blobId: "shared-image-blob",
              cid: "shared@example.test",
              disposition: "inline",
              name: "shared.png",
              partId: "part-shared",
              size: 12,
              type: "image/png",
            },
            {
              blobId: "inline-image-blob",
              cid: "<Logo%40Example.TEST>",
              name: "logo.png",
              partId: "part-logo",
              size: 8,
              type: "IMAGE/PNG",
            },
          ],
        }),
      ).map(({ metadata }) => metadata.id),
    );
  });

  it("keeps native handles out of enumerable attachment data", () => {
    const [attachment] = bindJmapReceivedAttachments(
      "account-one",
      email({
        attachments: [
          {
            blobId: "private-provider-blob",
            cid: "<private-cid@example.test>",
            name: "image.png",
            partId: "private-provider-part",
            size: 4,
            type: "image/png",
          },
        ],
      }),
    );

    expect(attachment).toBeDefined();
    if (!attachment) return;
    expect(readJmapReceivedAttachmentProviderBlobId(attachment)).toBe(
      "private-provider-blob",
    );
    expect(JSON.stringify(attachment)).not.toContain("private-provider-blob");
    expect(JSON.stringify(attachment)).not.toContain("private-provider-part");
    expect(JSON.stringify(attachment.metadata)).not.toContain(
      "private-cid@example.test",
    );
  });

  it("binds normalized CID, disposition, native part, and metadata into IDs", () => {
    const attachmentId = (
      overrides: Record<string, unknown> = {},
    ): string | undefined =>
      bindJmapReceivedAttachments(
        "account-one",
        email({
          attachments: [
            {
              blobId: "blob",
              cid: "logo@example.test",
              disposition: "inline",
              name: "logo.png",
              partId: "part-one",
              size: 4,
              type: "image/png",
              ...overrides,
            },
          ],
        }),
      )[0]?.metadata.id;
    const base = attachmentId();

    expect(base).toBeDefined();
    for (const overrides of [
      { cid: "Logo@example.test" },
      { disposition: "attachment" },
      { name: "other.png" },
      { partId: "part-two" },
      { size: 5 },
      { type: "image/jpeg" },
    ]) {
      expect(attachmentId(overrides)).not.toBe(base);
    }
  });

  it("fails closed when normalized Content-IDs are ambiguous", () => {
    const attachments = bindJmapReceivedAttachments(
      "account-one",
      email({
        attachments: [
          {
            blobId: "blob-one",
            cid: "<logo@example.test>",
            name: "one.png",
            partId: "one",
            size: 1,
            type: "image/png",
          },
          {
            blobId: "blob-two",
            cid: "logo@example.test",
            name: "two.png",
            partId: "two",
            size: 1,
            type: "image/png",
          },
          {
            blobId: "blob-three",
            cid: "Logo@example.test",
            name: "case-sensitive.png",
            partId: "three",
            size: 1,
            type: "image/png",
          },
        ],
      }),
    );

    expect(jmapInlineImageCandidates(attachments)).toEqual([
      {
        attachmentId: attachments[2]?.metadata.id,
        contentId: "Logo@example.test",
      },
    ]);
  });
});
