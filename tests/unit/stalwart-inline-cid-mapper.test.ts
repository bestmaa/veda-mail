import { describe, expect, it } from "vitest";

import { mapMessageDetail } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.mapper";
import { jmapEmailSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import type { JmapEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const email: JmapEmail = {
  bodyValues: { html: { value: "<p>Body</p>" } },
  hasAttachment: false,
  htmlBody: [{ partId: "html", type: "text/html" }],
  id: "email-one",
  keywords: {},
  mailboxIds: { inbox: true },
  preview: "Body",
  receivedAt: "2026-07-23T10:00:00.000Z",
  size: 120,
  subject: "Inline image",
  threadId: "thread-one",
};

describe("Stalwart inline CID mapping", () => {
  it("validates JMAP Content-ID and disposition body properties", () => {
    const parsed = jmapEmailSchema.parse({
      ...email,
      attachments: [
        {
          blobId: "blob",
          cid: "logo@example.test",
          disposition: "inline",
          name: null,
          partId: "image",
          size: null,
          type: "image/png",
        },
      ],
    });

    expect(parsed.attachments?.[0]).toMatchObject({
      cid: "logo@example.test",
      disposition: "inline",
      size: null,
    });
    expect(() =>
      jmapEmailSchema.parse({
        ...email,
        attachments: [
          {
            blobId: "blob",
            cid: "x".repeat(4_097),
            disposition: "inline",
            type: "image/png",
          },
        ],
      }),
    ).toThrow();
  });

  it("maps a unique embedded image to an opaque sanitizer marker", () => {
    const detail = mapMessageDetail(
      {
        ...email,
        attachments: [],
        bodyValues: {
          html: {
            value:
              '<p>Logo</p><img src="cid:logo%40example.test" alt="Company logo"><img src="https://tracker.invalid/pixel">',
          },
        },
        htmlBody: [
          { partId: "html", type: "text/html" },
          {
            blobId: "private-inline-blob",
            cid: "<logo@example.test>",
            disposition: "inline",
            name: "logo.png",
            partId: "inline-logo",
            size: null,
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
      name: "logo.png",
      size: null,
    });
    expect(detail.htmlBody).toContain(
      `data-veda-inline-image="${attachment?.id}"`,
    );
    expect(detail.htmlBody).not.toContain("cid:");
    expect(detail.htmlBody).not.toContain("tracker.invalid");
    expect(JSON.stringify(detail)).not.toContain("private-inline-blob");
    expect(JSON.stringify(detail.attachments)).not.toContain(
      "logo@example.test",
    );
  });

  it("does not authorize an ambiguous embedded Content-ID", () => {
    const detail = mapMessageDetail({
      ...email,
      attachments: [
        {
          blobId: "one",
          cid: "logo@example.test",
          name: "one.png",
          partId: "one",
          size: 1,
          type: "image/png",
        },
        {
          blobId: "two",
          cid: "<logo@example.test>",
          name: "two.png",
          partId: "two",
          size: 1,
          type: "image/png",
        },
      ],
      bodyValues: {
        html: {
          value: '<p>Body</p><img src="cid:logo@example.test">',
        },
      },
      htmlBody: [{ partId: "html", type: "text/html" }],
    });

    expect(detail.attachments).toHaveLength(2);
    expect(
      detail.attachments.map(({ disposition }) => disposition),
    ).toEqual(["attachment", "attachment"]);
    expect(detail.htmlBody).not.toContain("data-veda-inline-image");
    expect(detail.htmlBody).not.toContain("<img");
  });

  it("does not authorize active or unsupported image MIME types", () => {
    const detail = mapMessageDetail({
      ...email,
      attachments: [
        {
          blobId: "active-image",
          cid: "active@example.test",
          disposition: "inline",
          name: "active.svg",
          partId: "active",
          size: 100,
          type: "image/svg+xml",
        },
      ],
      bodyValues: {
        html: {
          value: '<img src="cid:active@example.test" alt="Active image">',
        },
      },
      htmlBody: [{ partId: "html", type: "text/html" }],
    });

    expect(detail.attachments).toHaveLength(1);
    expect(detail.htmlBody).toBeNull();
  });

});
