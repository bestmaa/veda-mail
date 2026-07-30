import { describe, expect, it, vi } from "vitest";

import type { MailApplicationService } from "@/application/services/mail-application.service";
import { id } from "@/domain/shared/brand";
import { preflightAttachmentArchive } from "@/server/mail/attachment-archive";

const messageId = id.message("archive-provider-list");
const metadata = {
  disposition: "attachment" as const,
  id: id.attachment("attachment-provider-list"),
  mimeType: "application/octet-stream",
  name: "attachment.bin",
  size: null,
};

const preflight = (attachments: readonly unknown[]) => {
  const getMessage = vi.fn(() => {
    throw new Error("Archive must not load MessageDetail.");
  });
  const mail = {
    downloadAttachment: vi.fn(),
    getMessage,
    listMessageAttachments: vi.fn(async () => attachments),
  } as unknown as MailApplicationService;
  return {
    getMessage,
    pending: preflightAttachmentArchive({
      mail,
      messageId,
      requestSignal: new AbortController().signal,
    }),
  };
};

describe("attachment archive provider list contract", () => {
  it("accepts a final visible fallback without loading MessageDetail", async () => {
    const result = preflight([metadata]);

    await expect(result.pending).resolves.toBeUndefined();
    expect(result.getMessage).not.toHaveBeenCalled();
  });

  it("rejects an empty final visible selection", async () => {
    const result = preflight([]);

    await expect(result.pending).rejects.toMatchObject({
      code: "ATTACHMENT_ARCHIVE_EMPTY",
    });
    expect(result.getMessage).not.toHaveBeenCalled();
  });

  it.each([
    {
      attachments: [{ ...metadata, disposition: "inline" as const }],
      name: "a rendered-inline entry",
    },
    {
      attachments: [metadata, metadata],
      name: "duplicate opaque IDs",
    },
  ])("fails closed for $name", async ({ attachments }) => {
    const result = preflight(attachments);

    await expect(result.pending).rejects.toMatchObject({
      code: "provider_failure",
    });
    expect(result.getMessage).not.toHaveBeenCalled();
  });
});
