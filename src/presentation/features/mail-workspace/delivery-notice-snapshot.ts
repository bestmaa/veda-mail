import {
  deliveryNoticeId,
  deliveryNoticeSubmittedAt,
  formatRejectedRecipients,
  MAX_DELIVERY_NOTICE_QUEUE,
  MAX_PARTIAL_DELIVERY_RECIPIENT_LENGTH,
  MAX_PARTIAL_DELIVERY_RECIPIENTS,
  mergeDeliveryNotices,
  type DeliveryNotice,
} from "@/presentation/features/mail-workspace/partial-delivery-notice";

type UnknownRecord = Readonly<Record<string, unknown>>;

const record = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const property = (value: UnknownRecord, key: string): unknown => {
  try {
    return value[key];
  } catch {
    return undefined;
  }
};

const metadata = (
  value: UnknownRecord,
): {
  readonly deliveryNoticeId: string;
  readonly submittedAt: string;
} | null => {
  const noticeId = deliveryNoticeId(property(value, "deliveryNoticeId"));
  const submittedAt = deliveryNoticeSubmittedAt(
    property(value, "submittedAt"),
  );
  return noticeId && submittedAt
    ? { deliveryNoticeId: noticeId, submittedAt }
    : null;
};

const partialRecipients = (value: unknown): readonly string[] | null => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_PARTIAL_DELIVERY_RECIPIENTS ||
    value.some(
      (recipient) =>
        typeof recipient !== "string" ||
        recipient.length === 0 ||
        recipient.length > MAX_PARTIAL_DELIVERY_RECIPIENT_LENGTH ||
        recipient.trim() !== recipient,
    )
  ) {
    return null;
  }
  const formatted = formatRejectedRecipients(value);
  return formatted.length === value.length &&
    formatted.every((recipient, index) => recipient === value[index])
    ? formatted
    : null;
};

const snapshotNotice = (value: unknown): DeliveryNotice | null => {
  const candidate = record(value);
  if (!candidate) return null;
  const base = metadata(candidate);
  if (!base) return null;
  const kind = property(candidate, "kind");
  if (kind === "uncertain") return { ...base, kind };
  if (kind === "overflow") return { ...base, kind };
  if (kind !== "partial") return null;
  const recipients = partialRecipients(
    property(candidate, "rejectedRecipients"),
  );
  return recipients
    ? { ...base, kind, rejectedRecipients: recipients }
    : { ...base, kind: "uncertain" };
};

export const parseDeliveryNoticeSnapshot = (
  value: unknown,
): readonly DeliveryNotice[] => {
  try {
    if (!Array.isArray(value)) return [{ kind: "overflow" }];
    let degraded = value.length > MAX_DELIVERY_NOTICE_QUEUE;
    let notices: readonly DeliveryNotice[] = [];
    for (const candidate of value.slice(0, MAX_DELIVERY_NOTICE_QUEUE)) {
      const notice = snapshotNotice(candidate);
      if (notice) {
        notices = mergeDeliveryNotices(notices, [notice]);
      } else {
        degraded = true;
      }
    }
    return degraded
      ? mergeDeliveryNotices(notices, [{ kind: "overflow" }])
      : notices;
  } catch {
    return [{ kind: "overflow" }];
  }
};
