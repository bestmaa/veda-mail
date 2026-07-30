export const MAX_PARTIAL_DELIVERY_RECIPIENTS = 100;
export const MAX_PARTIAL_DELIVERY_RECIPIENT_LENGTH = 254;
export const MAX_DELIVERY_NOTICE_QUEUE = 100;
const DELIVERY_NOTICE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_SUBMITTED_AT_LENGTH = 64;

interface DeliveryNoticeMetadata {
  readonly deliveryNoticeId?: string;
  readonly submittedAt?: string;
}

export type DeliveryNotice = DeliveryNoticeMetadata &
  (
    | {
        readonly kind: "partial";
        readonly rejectedRecipients: readonly string[];
      }
    | { readonly kind: "overflow" }
    | { readonly kind: "uncertain" }
  );

interface DeliveryReceiptInput {
  readonly deliveryNoticeId?: unknown;
  readonly deliveryStatus: string;
  readonly rejectedRecipients?: unknown;
  readonly submittedAt?: unknown;
}

const replaceControlCharacters = (value: string): string =>
  [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)
        ? " "
        : character;
    })
    .join("");

const formatRecipient = (value: string): string => {
  const wasTruncated =
    value.length > MAX_PARTIAL_DELIVERY_RECIPIENT_LENGTH;
  const normalized = replaceControlCharacters(
    value.slice(0, MAX_PARTIAL_DELIVERY_RECIPIENT_LENGTH),
  )
    .replace(/\s+/gu, " ")
    .trim();
  if (!wasTruncated) {
    return normalized;
  }
  return `${normalized.slice(
    0,
    MAX_PARTIAL_DELIVERY_RECIPIENT_LENGTH - 1,
  )}…`;
};

export const formatRejectedRecipients = (
  recipients: unknown,
): readonly string[] => {
  if (!Array.isArray(recipients)) return [];
  const formatted: string[] = [];
  const seen = new Set<string>();
  for (const rawRecipient of recipients.slice(
    0,
    MAX_PARTIAL_DELIVERY_RECIPIENTS,
  )) {
    if (typeof rawRecipient !== "string") continue;
    const recipient = formatRecipient(rawRecipient);
    const key = recipient.toLowerCase();
    if (!recipient || seen.has(key)) continue;
    seen.add(key);
    formatted.push(recipient);
  }
  return formatted;
};

const recipientKey = (recipient: string): string =>
  recipient.trim().toLowerCase();

const submittedRecipientMap = (
  recipients: readonly string[],
): ReadonlyMap<string, string> => {
  const submitted = new Map<string, string>();
  for (const recipient of formatRejectedRecipients(recipients)) {
    submitted.set(recipientKey(recipient), recipient);
  }
  return submitted;
};

export const deliveryNoticeId = (value: unknown): string | null =>
  typeof value === "string" && DELIVERY_NOTICE_ID_PATTERN.test(value)
    ? value
    : null;

export const deliveryNoticeSubmittedAt = (value: unknown): string | null => {
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

const receiptMetadata = (
  receipt: DeliveryReceiptInput,
): DeliveryNoticeMetadata => {
  const noticeId = deliveryNoticeId(receipt.deliveryNoticeId);
  const submittedAt = deliveryNoticeSubmittedAt(receipt.submittedAt);
  return {
    ...(noticeId ? { deliveryNoticeId: noticeId } : {}),
    ...(submittedAt ? { submittedAt } : {}),
  };
};

const overflowFrom = (notice: DeliveryNotice): DeliveryNotice => ({
  ...(notice.deliveryNoticeId
    ? { deliveryNoticeId: notice.deliveryNoticeId }
    : {}),
  ...(notice.submittedAt ? { submittedAt: notice.submittedAt } : {}),
  kind: "overflow",
});

const enqueue = (
  queue: readonly DeliveryNotice[],
  notice: DeliveryNotice,
): readonly DeliveryNotice[] => {
  const bounded = queue.slice(0, MAX_DELIVERY_NOTICE_QUEUE);
  const noticeId = notice.deliveryNoticeId;
  const existingIndex = noticeId
    ? bounded.findIndex(
        ({ deliveryNoticeId: currentId }) => currentId === noticeId,
      )
    : -1;
  if (existingIndex >= 0) {
    return bounded.map((current, index) =>
      index === existingIndex ? notice : current,
    );
  }
  const overflowIndex = bounded.findIndex(({ kind }) => kind === "overflow");
  if (notice.kind === "overflow" && overflowIndex >= 0) {
    const current = bounded[overflowIndex];
    return !current?.deliveryNoticeId && notice.deliveryNoticeId
      ? bounded.map((item, index) => (index === overflowIndex ? notice : item))
      : bounded;
  }
  if (bounded.length < MAX_DELIVERY_NOTICE_QUEUE) {
    return [...bounded, notice];
  }
  if (overflowIndex >= 0) return bounded;
  return [
    ...bounded.slice(0, -1),
    notice.kind === "overflow" ? notice : overflowFrom(notice),
  ];
};

export const mergeDeliveryNotices = (
  ...queues: readonly (readonly DeliveryNotice[])[]
): readonly DeliveryNotice[] =>
  queues.reduce<readonly DeliveryNotice[]>(
    (merged, queue) =>
      queue.reduce<readonly DeliveryNotice[]>(
        (current, notice) => enqueue(current, notice),
        merged,
      ),
    [],
  );

export const applyDeliveryReceipt = (
  queue: readonly DeliveryNotice[],
  receipt: DeliveryReceiptInput,
  submittedEmails: readonly string[],
): readonly DeliveryNotice[] => {
  const submitted = submittedRecipientMap(submittedEmails);
  if (receipt.deliveryStatus === "accepted") return queue;
  const metadata = receiptMetadata(receipt);
  if (receipt.deliveryStatus !== "partial") {
    return enqueue(queue, { ...metadata, kind: "uncertain" });
  }
  const candidates = formatRejectedRecipients(receipt.rejectedRecipients);
  const rejectedRecipients = candidates.flatMap((candidate) => {
    const submittedRecipient = submitted.get(recipientKey(candidate));
    return submittedRecipient ? [submittedRecipient] : [];
  });
  return enqueue(
    queue,
    rejectedRecipients.length > 0 &&
      rejectedRecipients.length < submitted.size
      ? { ...metadata, kind: "partial", rejectedRecipients }
      : { ...metadata, kind: "uncertain" },
  );
};

export const dismissDeliveryNotice = (
  queue: readonly DeliveryNotice[],
  target: DeliveryNotice | undefined = queue[0],
): readonly DeliveryNotice[] => {
  if (!target) return queue;
  const targetIndex = target.deliveryNoticeId
    ? queue.findIndex(
        ({ deliveryNoticeId: noticeId }) =>
          noticeId === target.deliveryNoticeId,
      )
    : queue.indexOf(target);
  return targetIndex < 0
    ? queue
    : [...queue.slice(0, targetIndex), ...queue.slice(targetIndex + 1)];
};

export const restoreDeliveryNotice = (
  queue: readonly DeliveryNotice[],
  notice: DeliveryNotice,
): readonly DeliveryNotice[] => mergeDeliveryNotices([notice], queue);
