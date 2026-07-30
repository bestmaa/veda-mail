import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  createAttachmentArchiveHref,
  createAttachmentDownloadHref,
  createAttachmentPreviewHref,
  createReceivedAttachmentViewModels,
} from "@/presentation/features/mail-workspace/received-attachment.view-model";

describe("attachment download link", () => {
  it("keeps the route same-origin and encodes both opaque identifiers", () => {
    expect(
      createAttachmentDownloadHref(
        "mailbox/message?tab=1",
        "attachment/name#section",
      ),
    ).toBe(
      "/api/v1/mail/messages/mailbox%2Fmessage%3Ftab%3D1/attachments/attachment%2Fname%23section",
    );
  });

  it("creates a same-origin archive route from only the opaque message ID", () => {
    expect(createAttachmentArchiveHref("mailbox/message?tab=1")).toBe(
      "/api/v1/mail/messages/mailbox%2Fmessage%3Ftab%3D1/attachments/archive",
    );
  });

  it("creates a nested preview route from only opaque identifiers", () => {
    expect(
      createAttachmentPreviewHref(
        "mailbox/message?tab=1",
        "attachment/name#section",
      ),
    ).toBe(
      "/api/v1/mail/messages/mailbox%2Fmessage%3Ftab%3D1/attachments/attachment%2Fname%23section/preview",
    );
  });

  it("maps received metadata without exposing another provider locator", () => {
    expect(
      createReceivedAttachmentViewModels("message-one", [
        {
          disposition: "attachment",
          id: id.attachment("opaque-attachment"),
          mimeType: "application/pdf",
          name: "report.pdf",
          size: 1_024,
        },
      ]),
    ).toEqual([
      {
        href:
          "/api/v1/mail/messages/message-one/attachments/opaque-attachment",
        id: "opaque-attachment",
        isPreviewing: false,
        meta: "application/pdf · 1 KB",
        name: "report.pdf",
        onPreview: null,
      },
    ]);
  });

  it("offers text preview without trusting provider-reported encoded size", () => {
    const open = vi.fn(async () => undefined);
    const [text, image, imapBase64Text] =
      createReceivedAttachmentViewModels(
      "message-one",
      [
        {
          disposition: "attachment",
          id: id.attachment("text-attachment"),
          mimeType: "TEXT/PLAIN; charset=utf-8",
          name: "notes.txt",
          size: 12,
        },
        {
          disposition: "attachment",
          id: id.attachment("image-attachment"),
          mimeType: "image/png",
          name: "photo.png",
          size: 12,
        },
        {
          disposition: "attachment",
          id: id.attachment("imap-base64-text"),
          mimeType: "text/plain",
          name: "decoded-under-limit.txt",
          // IMAP BODYSTRUCTURE can report larger transfer-encoded octets.
          size: 1_398_104,
        },
      ],
      { href: null, isLoading: false, open },
    );

    expect(text?.onPreview).toEqual(expect.any(Function));
    expect(image?.onPreview).toBeNull();
    expect(imapBase64Text?.onPreview).toEqual(expect.any(Function));
    const trigger = {} as HTMLButtonElement;
    text?.onPreview?.(trigger);
    expect(open).toHaveBeenCalledWith(
      "/api/v1/mail/messages/message-one/attachments/text-attachment/preview",
      "notes.txt",
      trigger,
    );
  });
});
