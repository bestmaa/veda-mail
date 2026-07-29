import "server-only";

import { OutgoingMessageSizeError } from "@/domain/mail/mail-errors";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { probeSmtpSizeLimit } from "@/infrastructure/providers/imap-smtp/smtp-size-probe";

const ABSOLUTE_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const MESSAGE_OVERHEAD_RESERVE_BYTES = 64 * 1024;
const CAPABILITY_CACHE_MS = 5 * 60 * 1000;

export interface SmtpAttachmentCapabilityPort {
  assertMessageBytes(messageBytes: number): Promise<void>;
  getMaxAttachmentBytes(): Promise<number>;
}

export const encodedMimeAttachmentBytes = (contentBytes: number): number => {
  if (!Number.isSafeInteger(contentBytes) || contentBytes < 0) {
    throw new RangeError("Attachment byte length is invalid.");
  }
  const base64Characters = Math.ceil(contentBytes / 3) * 4;
  const lineBreakBytes = Math.ceil(base64Characters / 76) * 2;
  return base64Characters + lineBreakBytes;
};

export const attachmentBytesForMessageLimit = (
  messageLimit: number,
): number => {
  if (!Number.isSafeInteger(messageLimit) || messageLimit <= 0) return 0;
  let low = 0;
  let high = ABSOLUTE_ATTACHMENT_BYTES;
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    const encoded =
      encodedMimeAttachmentBytes(candidate) + MESSAGE_OVERHEAD_RESERVE_BYTES;
    if (encoded <= messageLimit) {
      low = candidate;
    } else {
      high = candidate - 1;
    }
  }
  return low;
};

const configuredMessageLimit = (
  config: ImapSmtpMemberConfig,
): number | null => {
  const value = Number(config.smtpMaxMessageBytes);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};

const selectMessageLimit = (
  advertised: number | null,
  configured: number | null,
): number | null => {
  if (advertised && configured) return Math.min(advertised, configured);
  return advertised ?? configured;
};

export class SmtpAttachmentCapability implements SmtpAttachmentCapabilityPort {
  private cached:
    { readonly expiresAt: number; readonly value: number | null } | undefined;
  private pending: Promise<number | null> | undefined;

  public constructor(
    private readonly config: ImapSmtpMemberConfig,
    private readonly probe: () => Promise<number | null> = () =>
      probeSmtpSizeLimit(config),
    private readonly now: () => number = Date.now,
  ) {}

  public async assertMessageBytes(messageBytes: number): Promise<void> {
    if (!Number.isSafeInteger(messageBytes) || messageBytes < 0) {
      throw new RangeError("SMTP message byte length is invalid.");
    }
    const maximum = await this.getMaxMessageBytes();
    if (maximum === null) {
      throw new Error("SMTP SIZE limit could not be verified.");
    }
    if (messageBytes > maximum) {
      throw new OutgoingMessageSizeError();
    }
  }

  public async getMaxAttachmentBytes(): Promise<number> {
    const maximum = await this.getMaxMessageBytes();
    return maximum === null ? 0 : attachmentBytesForMessageLimit(maximum);
  }

  private async getMaxMessageBytes(): Promise<number | null> {
    if (this.cached && this.cached.expiresAt > this.now()) {
      return this.cached.value;
    }
    this.pending ??= this.probe()
      .then((advertised) => {
        const value = selectMessageLimit(
          advertised,
          configuredMessageLimit(this.config),
        );
        this.cached = {
          expiresAt: this.now() + CAPABILITY_CACHE_MS,
          value,
        };
        return value;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
}
