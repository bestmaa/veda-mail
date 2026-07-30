import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  createAttachmentArchiveHref,
  createAttachmentDownloadHref,
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

  it("maps received metadata without exposing another provider locator", () => {
    expect(
      createReceivedAttachmentViewModels("message-one", [
        {
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
        meta: "application/pdf · 1 KB",
        name: "report.pdf",
      },
    ]);
  });
});
