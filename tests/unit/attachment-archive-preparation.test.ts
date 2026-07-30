import { describe, expect, it, vi } from "vitest";

import type { MailApplicationService } from "@/application/services/mail-application.service";
import type { AttachmentDownload } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import type { AttachmentDownloadLease } from "@/server/mail/attachment-download-concurrency";
import { prepareAttachmentArchive } from "@/server/mail/attachment-archive";

const messageId = id.message("archive-preparation");
const metadata = {
  id: id.attachment("attachment-preparation"),
  mimeType: "application/octet-stream",
  name: "attachment.bin",
  size: null,
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const lease = (release: () => void): AttachmentDownloadLease =>
  ({ release }) as AttachmentDownloadLease;

describe("attachment archive preparation", () => {
  it("races a non-compliant metadata lookup and releases its lease", async () => {
    const request = new AbortController();
    const release = vi.fn();
    const listMessageAttachments = vi.fn(
      () => new Promise<never>(() => undefined),
    );
    const mail = {
      downloadAttachment: vi.fn(),
      listMessageAttachments,
    } as unknown as MailApplicationService;

    const pending = prepareAttachmentArchive({
      lease: lease(release),
      mail,
      messageId,
      requestSignal: request.signal,
    });
    request.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(release).toHaveBeenCalledOnce();
  });

  it("cancels a first download that resolves after request abort", async () => {
    const request = new AbortController();
    const release = vi.fn();
    const cancelled = vi.fn();
    const pendingDownload = deferred<AttachmentDownload>();
    const downloadAttachment = vi.fn(() => pendingDownload.promise);
    const mail = {
      downloadAttachment,
      listMessageAttachments: vi.fn(async () => [metadata]),
    } as unknown as MailApplicationService;

    const pending = prepareAttachmentArchive({
      lease: lease(release),
      mail,
      messageId,
      requestSignal: request.signal,
    });
    await vi.waitFor(() => expect(downloadAttachment).toHaveBeenCalledOnce());
    request.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    pendingDownload.resolve({
      body: new ReadableStream({ cancel: cancelled }),
      mimeType: metadata.mimeType,
      name: metadata.name,
      size: null,
    });
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
    expect(release).toHaveBeenCalledOnce();
  });

  it("redacts unknown provider preparation failures", async () => {
    const release = vi.fn();
    const mail = {
      downloadAttachment: vi.fn(),
      listMessageAttachments: vi.fn(async () => {
        throw new Error("private-provider.example/blob/secret");
      }),
    } as unknown as MailApplicationService;

    const pending = prepareAttachmentArchive({
      lease: lease(release),
      mail,
      messageId,
      requestSignal: new AbortController().signal,
    });

    await expect(pending).rejects.toMatchObject({
      code: "provider_failure",
      message: expect.not.stringContaining("private-provider"),
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases its lease when a provider returns a malformed body", async () => {
    const release = vi.fn();
    const mail = {
      downloadAttachment: vi.fn(async () => ({
        body: null,
        mimeType: metadata.mimeType,
        name: metadata.name,
        size: null,
      })),
      listMessageAttachments: vi.fn(async () => [metadata]),
    } as unknown as MailApplicationService;

    const pending = prepareAttachmentArchive({
      lease: lease(release),
      mail,
      messageId,
      requestSignal: new AbortController().signal,
    });

    await expect(pending).rejects.toMatchObject({ code: "provider_failure" });
    expect(release).toHaveBeenCalledOnce();
  });
});
