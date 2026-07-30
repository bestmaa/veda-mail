import { describe, expect, it } from "vitest";

import { mapMessageDetail } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.mapper";
import type { JmapEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const email: JmapEmail = {
  bodyValues: {},
  hasAttachment: false,
  id: "email-sequential",
  keywords: {},
  mailboxIds: { inbox: true },
  preview: "",
  receivedAt: "2026-07-23T10:00:00.000Z",
  size: 120,
  subject: "Sequential inline body",
  threadId: "thread-sequential",
};

describe("Stalwart sequential inline body mapping", () => {
  it("renders an image-only body without a provider CID", () => {
    const detail = mapMessageDetail(
      {
        ...email,
        htmlBody: [
          {
            blobId: "private-image-only-blob",
            name: "Company logo.png",
            partId: "private-image-only-part",
            size: 24,
            type: "image/png",
          },
        ],
      },
      "account-one",
    );
    const attachment = detail.attachments[0];

    expect(attachment).toMatchObject({
      disposition: "inline",
      mimeType: "image/png",
      name: "Company logo.png",
      size: 24,
    });
    expect(detail.htmlBody).toContain(
      `data-veda-inline-image="${attachment?.id}"`,
    );
    expect(detail.htmlBody).toContain('alt="Company logo.png"');
    expect(JSON.stringify(detail)).not.toContain(
      "private-image-only-blob",
    );
    expect(JSON.stringify(detail)).not.toContain(
      "private-image-only-part",
    );
  });

  it("preserves mixed text and image body order", () => {
    const detail = mapMessageDetail(
      {
        ...email,
        bodyValues: {
          footer: { value: "<p>After image</p>" },
          header: { value: "<p>Before image</p>" },
        },
        htmlBody: [
          { partId: "header", type: "text/html" },
          {
            blobId: "mixed-private-blob",
            cid: "mixed@example.test",
            name: "middle.webp",
            partId: "mixed-private-part",
            size: 40,
            type: "image/webp",
          },
          { partId: "footer", type: "text/html" },
        ],
      },
      "account-one",
    );
    const html = detail.htmlBody ?? "";
    const marker = `data-veda-inline-image="${detail.attachments[0]?.id}"`;

    expect(html.indexOf("Before image")).toBeLessThan(
      html.indexOf(marker),
    );
    expect(html.indexOf(marker)).toBeLessThan(
      html.indexOf("After image"),
    );
    expect(html).not.toContain("mixed-private-blob");
    expect(html).not.toContain("mixed-private-part");
    expect(html).not.toContain("mixed@example.test");
  });

  it("fails closed for ambiguous Content-IDs", () => {
    const detail = mapMessageDetail({
      ...email,
      htmlBody: [
        {
          blobId: "ambiguous-one",
          cid: "<same@example.test>",
          name: "one.png",
          partId: "one",
          size: 1,
          type: "image/png",
        },
        {
          blobId: "ambiguous-two",
          cid: "same@example.test",
          name: "two.png",
          partId: "two",
          size: 1,
          type: "image/png",
        },
      ],
    });

    expect(detail.attachments).toHaveLength(2);
    expect(
      detail.attachments.map(({ disposition }) => disposition),
    ).toEqual(["attachment", "attachment"]);
    expect(detail.htmlBody).toBeNull();
  });

  it("safely renders an ordered image with a malformed surrogate CID", () => {
    const detail = mapMessageDetail({
      ...email,
      htmlBody: [
        {
          blobId: "malformed-cid-blob",
          cid: "\ud800",
          name: "malformed-cid.png",
          partId: "malformed-cid-part",
          size: 1,
          type: "image/png",
        },
      ],
    });

    expect(detail.htmlBody).toContain(
      `data-veda-inline-image="${detail.attachments[0]?.id}"`,
    );
    expect(detail.htmlBody).not.toContain("\ud800");
  });

  it("applies the global inline image render cap", () => {
    const htmlBody = Array.from({ length: 9 }, (_, index) => ({
      blobId: `blob-${index}`,
      name: `image-${index}.png`,
      partId: `part-${index}`,
      size: 1,
      type: "image/png",
    }));
    const detail = mapMessageDetail({ ...email, htmlBody });

    expect(detail.attachments).toHaveLength(9);
    expect(
      detail.htmlBody?.match(/data-veda-inline-image=/gu),
    ).toHaveLength(8);
    expect(
      detail.attachments.map(({ disposition }) => disposition),
    ).toEqual([
      "inline",
      "inline",
      "inline",
      "inline",
      "inline",
      "inline",
      "inline",
      "inline",
      "attachment",
    ]);
  });

  it("keeps unsupported media as a safe attachment fallback", () => {
    const detail = mapMessageDetail({
      ...email,
      htmlBody: [
        {
          blobId: "active-body-blob",
          cid: "active-body@example.test",
          disposition: "inline",
          name: "active-body.svg",
          partId: "active-body-part",
          size: 100,
          type: "image/svg+xml",
        },
      ],
    });

    expect(detail.htmlBody).toBeNull();
    expect(detail.attachments).toMatchObject([
      {
        disposition: "attachment",
        mimeType: "image/svg+xml",
        name: "active-body.svg",
      },
    ]);
  });
});
