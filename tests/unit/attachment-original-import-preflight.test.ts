import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { ATTACHMENT_IMPORT_TIMEOUT_MS } from "@/server/mail/attachment-import-operation";

const mocks = vi.hoisted(() => ({
  assertAttachmentCapability: vi.fn(),
  downloadAttachment: vi.fn(),
  getMailService: vi.fn(),
  importReceivedAttachment: vi.fn(),
  listMessageAttachments: vi.fn(),
  removeAttachment: vi.fn(),
}));

vi.mock("@/server/mail/attachment-import", () => ({
  importReceivedAttachment: mocks.importReceivedAttachment,
  mapAttachmentImportFailure: (
    error: unknown,
    timedOut: boolean,
    requestAborted: boolean,
  ) =>
    timedOut
      ? Object.assign(new Error("Import timed out."), { code: "timeout" })
      : requestAborted
        ? Object.assign(new Error("Import aborted."), { code: "aborted" })
        : error,
}));
vi.mock("@/server/mail/attachment-service", () => ({
  assertAttachmentCapability: mocks.assertAttachmentCapability,
  attachmentScope: vi.fn(),
  attachmentService: vi.fn(() => ({ remove: mocks.removeAttachment })),
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));

import { importOriginalAttachment } from "@/server/mail/attachment-original-import";

const connection = {
  config: { username: "member@example.com" },
  createdAt: "2026-07-30T00:00:00.000Z",
  displayName: "Member",
  id: id.connection("preflight-connection"),
  providerId: id.provider("mock"),
};
const input = (signal?: AbortSignal) => ({
  attachmentId: id.attachment("opaque-preflight-attachment"),
  connection,
  draftId: id.draft("8ec9269d-9aa7-4c7a-97dd-440d011fbb8f"),
  messageId: id.message("opaque-preflight-message"),
  ...(signal ? { signal } : {}),
});
const attachment = (disposition: "attachment" | "inline") => ({
  disposition,
  id: input().attachmentId,
  mimeType: "image/png",
  name: "provider-only-name.png",
  size: 128,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMailService.mockResolvedValue({
    downloadAttachment: mocks.downloadAttachment,
    listMessageAttachments: mocks.listMessageAttachments,
  });
  mocks.assertAttachmentCapability.mockImplementation(
    () => new Promise(() => undefined),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("original attachment import preflight deadline", () => {
  it("settles a disconnected request without starting provider download", async () => {
    const abort = new AbortController();
    const pending = importOriginalAttachment(input(abort.signal));
    await vi.waitFor(() =>
      expect(mocks.assertAttachmentCapability).toHaveBeenCalledOnce(),
    );

    abort.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.importReceivedAttachment).not.toHaveBeenCalled();
  });

  it("maps the whole-operation deadline to a timeout", async () => {
    vi.useFakeTimers();
    const pending = importOriginalAttachment(input());
    const rejection = expect(pending).rejects.toMatchObject({
      code: "timeout",
    });

    await vi.advanceTimersByTimeAsync(ATTACHMENT_IMPORT_TIMEOUT_MS);

    await rejection;
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.importReceivedAttachment).not.toHaveBeenCalled();
  });
});

describe("original attachment import authorization", () => {
  it.each([
    ["unlisted", []],
    ["inline", [attachment("inline")]],
  ] as const)(
    "rejects a well-formed %s ID before download or quarantine",
    async (_case, originals) => {
      mocks.assertAttachmentCapability.mockResolvedValue(1_024);
      mocks.listMessageAttachments.mockResolvedValue(originals);

      await expect(importOriginalAttachment(input())).rejects.toMatchObject({
        code: "not_found",
      });

      expect(mocks.listMessageAttachments).toHaveBeenCalledWith({
        messageId: input().messageId,
        signal: expect.any(AbortSignal),
      });
      expect(mocks.downloadAttachment).not.toHaveBeenCalled();
      expect(mocks.importReceivedAttachment).not.toHaveBeenCalled();
    },
  );

  it("allows a currently listed visible attachment into quarantine import", async () => {
    const imported = {
      contentLength: 128,
      detectedMimeType: "image/png",
      fileName: "provider-only-name.png",
      id: "imported-attachment",
      state: "clean",
    };
    mocks.assertAttachmentCapability.mockResolvedValue(1_024);
    mocks.listMessageAttachments.mockResolvedValue([
      attachment("attachment"),
    ]);
    mocks.importReceivedAttachment.mockResolvedValue(imported);

    await expect(importOriginalAttachment(input())).resolves.toBe(imported);
    expect(mocks.importReceivedAttachment).toHaveBeenCalledOnce();
  });
});
