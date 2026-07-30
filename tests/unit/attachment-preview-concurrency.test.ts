import { describe, expect, it } from "vitest";

import { acquireAttachmentPreviewLease } from "@/server/mail/attachment-preview-concurrency";

describe("attachment preview concurrency", () => {
  it("allows two members globally but only one preview per member", () => {
    const first = acquireAttachmentPreviewLease("preview-member-one");
    expect(() =>
      acquireAttachmentPreviewLease("preview-member-one"),
    ).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_PREVIEW_BUSY", status: 429 }),
    );
    const second = acquireAttachmentPreviewLease("preview-member-two");
    expect(() =>
      acquireAttachmentPreviewLease("preview-member-three"),
    ).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_PREVIEW_BUSY", status: 429 }),
    );

    first.release();
    first.release();
    const third = acquireAttachmentPreviewLease("preview-member-three");
    second.release();
    third.release();
  });
});
