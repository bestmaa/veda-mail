import { describe, expect, it } from "vitest";

import { createAttachmentDownloadHref } from "@/presentation/features/mail-workspace/hooks/use-mail-workspace-model";

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
});
