import { describe, expect, it, vi } from "vitest";

import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import {
  attachmentBytesForMessageLimit,
  encodedMimeAttachmentBytes,
  SmtpAttachmentCapability,
} from "@/infrastructure/providers/imap-smtp/smtp-attachment-capability";
import { readAdvertisedSmtpSize } from "@/infrastructure/providers/imap-smtp/smtp-size-probe";

const config = (smtpMaxMessageBytes = "0"): ImapSmtpMemberConfig => ({
  imapHost: "imap.example.com",
  imapPort: "993",
  imapSecurity: "tls",
  secret: "secret",
  smtpHost: "smtp.example.com",
  smtpMaxMessageBytes,
  smtpPort: "465",
  smtpSecurity: "tls",
  username: "sender@example.com",
});

describe("SMTP attachment capability", () => {
  it("reads only a bounded EHLO SIZE extension", () => {
    expect(
      readAdvertisedSmtpSize({
        _maxAllowedSize: 10_000_000,
        _supportedExtensions: ["PIPELINING", "SIZE"],
      }),
    ).toBe(10_000_000);
    expect(
      readAdvertisedSmtpSize({
        _maxAllowedSize: 10_000_000,
        _supportedExtensions: ["PIPELINING"],
      }),
    ).toBeNull();
    expect(
      readAdvertisedSmtpSize({
        _maxAllowedSize: Number.MAX_SAFE_INTEGER + 1,
        _supportedExtensions: ["SIZE"],
      }),
    ).toBeNull();
  });

  it("accounts for base64 lines and reserved MIME envelope bytes", () => {
    const messageLimit = 10 * 1024 * 1024;
    const attachmentLimit = attachmentBytesForMessageLimit(messageLimit);

    expect(attachmentLimit).toBeLessThan(messageLimit);
    expect(
      encodedMimeAttachmentBytes(attachmentLimit) + 64 * 1024,
    ).toBeLessThanOrEqual(messageLimit);
    expect(
      encodedMimeAttachmentBytes(attachmentLimit + 1) + 64 * 1024,
    ).toBeGreaterThan(messageLimit);
  });

  it("clamps to the lower provider/admin limit and caches the probe", async () => {
    const probe = vi.fn(async () => 10 * 1024 * 1024);
    const capability = new SmtpAttachmentCapability(
      config(String(5 * 1024 * 1024)),
      probe,
      () => 1_000,
    );

    await expect(capability.getMaxAttachmentBytes()).resolves.toBe(
      attachmentBytesForMessageLimit(5 * 1024 * 1024),
    );
    await expect(capability.getMaxAttachmentBytes()).resolves.toBe(
      attachmentBytesForMessageLimit(5 * 1024 * 1024),
    );
    await expect(
      capability.assertMessageBytes(5 * 1024 * 1024 + 1),
    ).rejects.toThrow("Reduce the message body or attachments");
    expect(probe).toHaveBeenCalledOnce();
  });

  it("disables attachments when neither SMTP nor admin supplies a limit", async () => {
    const capability = new SmtpAttachmentCapability(config(), async () => null);

    await expect(capability.getMaxAttachmentBytes()).resolves.toBe(0);
    await expect(capability.assertMessageBytes(1)).rejects.toThrow(
      "could not be verified",
    );
  });

  it("does not cache a transient SMTP probe failure", async () => {
    const probe = vi
      .fn<() => Promise<number | null>>()
      .mockRejectedValueOnce(new Error("SMTP unavailable"))
      .mockResolvedValueOnce(2 * 1024 * 1024);
    const capability = new SmtpAttachmentCapability(config(), probe);

    await expect(capability.getMaxAttachmentBytes()).rejects.toThrow(
      "SMTP unavailable",
    );
    await expect(capability.getMaxAttachmentBytes()).resolves.toBeGreaterThan(
      0,
    );
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
