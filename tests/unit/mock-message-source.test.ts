import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { MessageSourceDownloadError } from "@/domain/mail/message-source-download-error";
import { createMockMessages } from "@/infrastructure/providers/mock/mock-seed";
import { downloadMockMessageSource } from "@/infrastructure/providers/mock/mock-message-source";

describe("mock message source export", () => {
  it("emits a deterministic RFC 5322 message without header injection", async () => {
    const message = { ...createMockMessages()[0]!, subject: "Hello\r\nBcc: hidden@example.com" };
    const result = downloadMockMessageSource([message], {
      maxBytes: 50_000,
      messageId: message.id,
    });
    const source = await new Response(result.body).text();
    expect(source).toContain("Subject: Hello  Bcc: hidden@example.com\r\n");
    expect(source).not.toContain("\r\nBcc: hidden@example.com\r\n");
    expect(result.size).toBe(new TextEncoder().encode(source).byteLength);
  });

  it("fails closed for unknown and oversized messages", () => {
    expect(() => downloadMockMessageSource(createMockMessages(), {
      maxBytes: 50_000,
      messageId: id.message("missing"),
    })).toThrowError(MessageSourceDownloadError);
    const message = createMockMessages()[0]!;
    expect(() => downloadMockMessageSource([message], {
      maxBytes: 1,
      messageId: message.id,
    })).toThrowError(MessageSourceDownloadError);
  });
});
