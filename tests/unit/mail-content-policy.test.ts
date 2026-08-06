import { describe, expect, it } from "vitest";

import { DEFAULT_MAIL_CONTENT_POLICY } from "@/domain/installation/mail-content-policy";
import { mailContentPolicySchema } from "@/server/organization/mail-content-policy.schema";
import {
  assertAttachmentFilePolicy,
  assertOutgoingMailPolicy,
} from "@/server/organization/mail-content-policy.service";

const policy = (overrides = {}) => ({
  ...DEFAULT_MAIL_CONTENT_POLICY,
  ...overrides,
});
const content = {
  bcc: [], body: "Hello", cc: [], subject: "Test", to: [],
};

describe("mail content policy", () => {
  it("normalizes, deduplicates, and sorts extension and MIME rules", () => {
    const parsed = mailContentPolicySchema.parse(policy({
      allowedExtensions: [".PDF", "txt", "pdf"],
      blockedMimeTypes: ["IMAGE/PNG", "application/pdf"],
    }));
    expect(parsed.allowedExtensions).toEqual(["pdf", "txt"]);
    expect(parsed.blockedMimeTypes).toEqual(["application/pdf", "image/png"]);
  });

  it("rejects contradictory rules and an attachment limit above message limit", () => {
    expect(() => mailContentPolicySchema.parse(policy({
      allowedExtensions: ["pdf"], blockedExtensions: ["pdf"],
    }))).toThrow();
    expect(() => mailContentPolicySchema.parse(policy({
      maxAttachmentBytes: 10, maxMessageBytes: 9,
    }))).toThrow();
  });

  it("applies blocklists before allowlists using detected MIME", () => {
    expect(() => assertAttachmentFilePolicy(policy({
      allowedExtensions: ["pdf"], blockedMimeTypes: ["application/x-msdownload"],
    }), { mimeType: "application/x-msdownload", name: "invoice.pdf", size: 12 }))
      .toThrowError(expect.objectContaining({ code: "ORGANIZATION_MIME_TYPE_BLOCKED" }));
    expect(() => assertAttachmentFilePolicy(policy({ allowedExtensions: ["pdf"] }), {
      mimeType: "text/plain", name: "notes.txt", size: 12,
    })).toThrowError(expect.objectContaining({ code: "ORGANIZATION_FILE_TYPE_NOT_ALLOWED" }));
  });

  it("enforces attachment count and combined UTF-8 message bytes", () => {
    expect(() => assertOutgoingMailPolicy(policy({ maxAttachmentsPerMessage: 1 }), content, [
      { name: "one.txt", size: 1 }, { name: "two.txt", size: 1 },
    ])).toThrowError(expect.objectContaining({ code: "ORGANIZATION_ATTACHMENT_COUNT_EXCEEDED" }));
    expect(() => assertOutgoingMailPolicy(policy({ maxAttachmentBytes: 1, maxMessageBytes: 8 }), content, []))
      .toThrowError(expect.objectContaining({ code: "ORGANIZATION_MESSAGE_TOO_LARGE" }));
  });
});
