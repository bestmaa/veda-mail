import "server-only";

import { Buffer } from "node:buffer";

import type { SendReceipt } from "@/domain/mail/mail";

export const DELIVERY_NOTICE_OVERFLOW_MESSAGE =
  "Additional delivery outcomes require review in Sent or with your mail provider.";

interface NoticeBase {
  readonly deliveryNoticeId: string;
  readonly submittedAt: string;
}

export type StoredDeliveryNotice =
  | (NoticeBase & {
      readonly kind: "partial";
      readonly rejectedRecipients: readonly string[];
    })
  | (NoticeBase & { readonly kind: "uncertain" })
  | (NoticeBase & {
      readonly kind: "overflow";
      readonly message: typeof DELIVERY_NOTICE_OVERFLOW_MESSAGE;
    });

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_RECIPIENTS = 100;
const MAX_RECIPIENT_LENGTH = 254;
const MAX_TIMESTAMP_LENGTH = 64;
const NOTICE_OVERHEAD_BYTES = 192;

const validTimestamp = (value: string): boolean => {
  if (value.length === 0 || value.length > MAX_TIMESTAMP_LENGTH) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

const noticeBase = (
  receipt: SendReceipt,
): { readonly deliveryNoticeId: string; readonly submittedAt: string } => {
  const deliveryNoticeId = receipt.deliveryNoticeId;
  if (
    typeof deliveryNoticeId !== "string" ||
    !UUID_PATTERN.test(deliveryNoticeId) ||
    !validTimestamp(receipt.submittedAt)
  ) {
    throw new TypeError("Delivery notice metadata is invalid.");
  }
  return { deliveryNoticeId, submittedAt: receipt.submittedAt };
};

const partialRecipients = (
  recipients: readonly string[],
): readonly string[] => {
  if (
    !Array.isArray(recipients) ||
    recipients.length === 0 ||
    recipients.length > MAX_RECIPIENTS
  ) {
    throw new TypeError("Partial delivery recipients are invalid.");
  }
  const seen = new Set<string>();
  const copy: string[] = [];
  for (const recipient of recipients) {
    if (typeof recipient !== "string") {
      throw new TypeError("Partial delivery recipients are invalid.");
    }
    const key = recipient.toLowerCase();
    if (
      recipient.length === 0 ||
      recipient.length > MAX_RECIPIENT_LENGTH ||
      recipient.trim() !== recipient ||
      seen.has(key)
    ) {
      throw new TypeError("Partial delivery recipients are invalid.");
    }
    seen.add(key);
    copy.push(recipient);
  }
  return copy;
};

export const noticeFromReceipt = (
  receipt: SendReceipt,
): StoredDeliveryNotice | null => {
  const deliveryStatus: unknown = receipt.deliveryStatus;
  if (deliveryStatus === "accepted") return null;
  const base = noticeBase(receipt);
  if (deliveryStatus === "uncertain") {
    if (receipt.rejectedRecipients.length !== 0) {
      throw new TypeError("Uncertain delivery cannot expose recipients.");
    }
    return { ...base, kind: "uncertain" };
  }
  if (deliveryStatus !== "partial") {
    throw new TypeError("Delivery notice status is invalid.");
  }
  return {
    ...base,
    kind: "partial",
    rejectedRecipients: partialRecipients(receipt.rejectedRecipients),
  };
};

export const cloneDeliveryNotice = (
  notice: StoredDeliveryNotice,
): StoredDeliveryNotice =>
  notice.kind === "partial"
    ? { ...notice, rejectedRecipients: [...notice.rejectedRecipients] }
    : { ...notice };

export const asOverflowNotice = (
  notice: StoredDeliveryNotice,
): StoredDeliveryNotice => ({
  deliveryNoticeId: notice.deliveryNoticeId,
  kind: "overflow",
  message: DELIVERY_NOTICE_OVERFLOW_MESSAGE,
  submittedAt: notice.submittedAt,
});

export const deliveryNoticeBytes = (
  notice: StoredDeliveryNotice,
): number => {
  const strings = [
    notice.deliveryNoticeId,
    notice.submittedAt,
    ...(notice.kind === "partial" ? notice.rejectedRecipients : []),
    ...(notice.kind === "overflow" ? [notice.message] : []),
  ];
  return strings.reduce(
    (total, value) =>
      total +
      Math.max(Buffer.byteLength(value, "utf8"), value.length * 2),
    NOTICE_OVERHEAD_BYTES,
  );
};
