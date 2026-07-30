import { describe, expect, it } from "vitest";

import { mapMessageDetail } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.mapper";
import type {
  JmapBodyPart,
  JmapEmail,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const email: JmapEmail = {
  bodyValues: {},
  hasAttachment: true,
  id: "email-shared-part",
  keywords: {},
  mailboxIds: { inbox: true },
  preview: "",
  receivedAt: "2026-07-23T10:00:00.000Z",
  size: 120,
  subject: "Shared sequential part",
  threadId: "thread-shared-part",
};

const sharedPart = (
  overrides: Partial<JmapBodyPart> = {},
): JmapBodyPart => ({
  blobId: "shared-private-blob",
  name: "shared.png",
  partId: "shared-private-part",
  size: 12,
  type: "image/png",
  ...overrides,
});

describe("Stalwart shared sequential inline binding", () => {
  it("renders an identical no-CID part listed in both body and attachments", () => {
    const part = sharedPart();
    const detail = mapMessageDetail(
      {
        ...email,
        attachments: [part],
        htmlBody: [part],
      },
      "account-one",
    );
    const attachment = detail.attachments[0];

    expect(detail.attachments).toHaveLength(1);
    expect(attachment?.disposition).toBe("inline");
    expect(detail.htmlBody).toContain(
      `data-veda-inline-image="${attachment?.id}"`,
    );
    expect(JSON.stringify(detail)).not.toContain("shared-private-blob");
    expect(JSON.stringify(detail)).not.toContain("shared-private-part");
  });

  it("keeps an explicitly attached shared body part as a fallback", () => {
    const part = sharedPart({ disposition: "attachment" });
    const detail = mapMessageDetail({
      ...email,
      attachments: [part],
      htmlBody: [part],
    });

    expect(detail.attachments).toMatchObject([
      {
        disposition: "attachment",
        mimeType: "image/png",
        name: "shared.png",
      },
    ]);
    expect(detail.htmlBody).toBeNull();
  });

  it("fails closed when duplicate provider part IDs have mismatched bindings", () => {
    const detail = mapMessageDetail({
      ...email,
      attachments: [
        sharedPart({
          blobId: "attachment-private-blob",
          name: "attachment.png",
        }),
      ],
      htmlBody: [
        sharedPart({
          blobId: "different-body-private-blob",
          name: "body.png",
        }),
      ],
    });

    expect(detail.htmlBody).toBeNull();
    expect(detail.attachments).toMatchObject([
      {
        disposition: "attachment",
        mimeType: "image/png",
        name: "attachment.png",
      },
      {
        disposition: "attachment",
        mimeType: "image/png",
        name: "body.png",
      },
    ]);
    expect(JSON.stringify(detail)).not.toContain(
      "different-body-private-blob",
    );
  });

  it("keeps conflicting HTML-only part IDs as visible fallbacks", () => {
    const detail = mapMessageDetail({
      ...email,
      bodyValues: {
        html: {
          value: '<img src="cid:first@example.test" alt="Unsafe">',
        },
      },
      htmlBody: [
        { partId: "html", type: "text/html" },
        sharedPart({
          blobId: "first-private-blob",
          cid: "first@example.test",
          name: "first.png",
        }),
        sharedPart({
          blobId: "second-private-blob",
          cid: "second@example.test",
          name: "second.png",
        }),
      ],
    });

    expect(detail.htmlBody).toBeNull();
    expect(detail.attachments).toMatchObject([
      { disposition: "attachment", name: "first.png" },
      { disposition: "attachment", name: "second.png" },
    ]);
    expect(detail.attachments[0]?.id).not.toBe(
      detail.attachments[1]?.id,
    );
    expect(JSON.stringify(detail)).not.toContain("private-blob");
  });

  it("does not bind an image whose part ID is also used by text", () => {
    const image = sharedPart();
    const detail = mapMessageDetail({
      ...email,
      attachments: [image],
      bodyValues: {
        "shared-private-part": { value: "<p>Safe body</p>" },
      },
      htmlBody: [
        { partId: "shared-private-part", type: "text/html" },
        image,
      ],
    });

    expect(detail.htmlBody).toContain("Safe body");
    expect(detail.htmlBody).not.toContain("data-veda-inline-image");
    expect(detail.attachments).toMatchObject([
      { disposition: "attachment", name: "shared.png" },
    ]);
  });
});
