import { hasHeaderControlCharacter } from "@/domain/mail/header-safety";
import type { SendMessageInput, SendReceipt } from "@/domain/mail/mail";
import { id, type MessageId } from "@/domain/shared/brand";

const MAX_PROVIDER_ID_LENGTH = 2_048;
const MAX_RECIPIENT_LENGTH = 254;
const MAX_RECIPIENTS = 100;
const MAX_SUBMITTED_AT_LENGTH = 64;

export interface SendReceiptFallback {
  readonly deliveryNoticeId: string;
  readonly id: MessageId;
  readonly submittedAt: string;
}

interface SubmittedRecipients {
  readonly addresses: readonly string[];
  readonly byKey: ReadonlyMap<string, string>;
}

const uncertain = (fallback: SendReceiptFallback): SendReceipt => ({
  deliveryNoticeId: fallback.deliveryNoticeId,
  deliveryStatus: "uncertain",
  id: fallback.id,
  rejectedRecipients: [],
  submittedAt: fallback.submittedAt,
});

const providerRecord = (
  value: unknown,
): Readonly<Record<string, unknown>> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;

const readProperty = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): unknown => {
  try {
    return record[key];
  } catch {
    return undefined;
  }
};

const providerId = (value: unknown): MessageId | null => {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return candidate.length > 0 &&
    candidate.length <= MAX_PROVIDER_ID_LENGTH &&
    !hasHeaderControlCharacter(candidate)
    ? id.message(candidate)
    : null;
};

const providerSubmittedAt = (value: unknown): string | null => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SUBMITTED_AT_LENGTH
  ) {
    return null;
  }
  try {
    return new Date(value).toISOString() === value ? value : null;
  } catch {
    return null;
  }
};

const submittedRecipients = (
  input: SendMessageInput,
): SubmittedRecipients | null => {
  const addresses: string[] = [];
  const byKey = new Map<string, string>();
  let count = 0;
  for (const bucket of [input.to, input.cc, input.bcc]) {
    if (!Array.isArray(bucket)) return null;
    for (const recipient of bucket) {
      count += 1;
      if (count > MAX_RECIPIENTS || typeof recipient?.email !== "string") {
        return null;
      }
      const address = recipient.email.trim();
      const key = address.toLowerCase();
      if (!key || address.length > MAX_RECIPIENT_LENGTH) return null;
      if (byKey.has(key)) continue;
      byKey.set(key, address);
      addresses.push(address);
    }
  }
  return addresses.length > 0 ? { addresses, byKey } : null;
};

const canonicalPartialRecipients = (
  rejected: readonly unknown[],
  submitted: SubmittedRecipients,
): readonly string[] | null => {
  if (rejected.length === 0 || rejected.length > MAX_RECIPIENTS) return null;
  const seen = new Set<string>();
  for (const value of rejected) {
    if (typeof value !== "string" || value.length > MAX_RECIPIENT_LENGTH) {
      return null;
    }
    const key = value.trim().toLowerCase();
    const submittedAddress = submitted.byKey.get(key);
    if (!key || !submittedAddress) return null;
    seen.add(key);
  }
  const canonical = submitted.addresses.filter((address) =>
    seen.has(address.toLowerCase()),
  );
  return canonical.length > 0 &&
    canonical.length < submitted.addresses.length
    ? canonical
    : null;
};

export const canonicalizeSendReceipt = (
  input: SendMessageInput,
  providerReceipt: unknown,
  fallback: SendReceiptFallback,
): SendReceipt => {
  const record = providerRecord(providerReceipt);
  if (!record) return uncertain(fallback);
  try {
    const status = readProperty(record, "deliveryStatus");
    const rejected = readProperty(record, "rejectedRecipients");
    const receiptId = providerId(readProperty(record, "id")) ?? fallback.id;
    const submittedAt =
      providerSubmittedAt(readProperty(record, "submittedAt")) ??
      fallback.submittedAt;
    const metadata = { id: receiptId, submittedAt };
    if (!Array.isArray(rejected)) return uncertain(fallback);
    if (status === "accepted" && rejected.length === 0) {
      return { ...metadata, deliveryStatus: "accepted", rejectedRecipients: [] };
    }
    const submitted = submittedRecipients(input);
    const partial =
      status === "partial" && submitted
        ? canonicalPartialRecipients(rejected, submitted)
        : null;
    return partial
      ? {
          ...metadata,
          deliveryNoticeId: fallback.deliveryNoticeId,
          deliveryStatus: "partial",
          rejectedRecipients: partial,
        }
      : uncertain(fallback);
  } catch {
    return uncertain(fallback);
  }
};
