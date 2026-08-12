import { afterEach, describe, expect, it, vi } from "vitest";

const globals = globalThis as typeof globalThis & {
  __vedaMailAttachmentCleanupTimer?: NodeJS.Timeout;
  __vedaMailAttachmentScanner?: unknown;
  __vedaMailAttachmentService?: unknown;
};
const originalUrl = process.env["VEDA_MAIL_STATE_REDIS_URL"];
const originalKey = process.env["VEDA_MAIL_ATTACHMENT_KEY"];

describe("attachment service shared mode", () => {
  afterEach(() => {
    vi.resetModules();
    clearInterval(globals.__vedaMailAttachmentCleanupTimer);
    delete globals.__vedaMailAttachmentCleanupTimer;
    delete globals.__vedaMailAttachmentScanner;
    delete globals.__vedaMailAttachmentService;
    if (originalUrl === undefined) delete process.env["VEDA_MAIL_STATE_REDIS_URL"];
    else process.env["VEDA_MAIL_STATE_REDIS_URL"] = originalUrl;
    if (originalKey === undefined) delete process.env["VEDA_MAIL_ATTACHMENT_KEY"];
    else process.env["VEDA_MAIL_ATTACHMENT_KEY"] = originalKey;
  });

  it("requires one stable attachment key across shared replicas", async () => {
    process.env["VEDA_MAIL_STATE_REDIS_URL"] = "redis://127.0.0.1:6379";
    delete process.env["VEDA_MAIL_ATTACHMENT_KEY"];
    const { attachmentService } = await import(
      "@/server/mail/attachment-service"
    );
    expect(() => attachmentService()).toThrow(
      "VEDA_MAIL_ATTACHMENT_KEY is required for shared attachment quarantine.",
    );
  });
});
