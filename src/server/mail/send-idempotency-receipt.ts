import "server-only";

import type { SendReceipt } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { completedReceiptBytes } from "@/server/mail/send-idempotency-budget";

export const cloneSendReceipt = (receipt: SendReceipt): SendReceipt => ({
  ...receipt,
  rejectedRecipients: [...receipt.rejectedRecipients],
});

export const reservedSendReceipt = (
  receipt: SendReceipt,
  reservation: number,
): { readonly bytes: number; readonly receipt: SendReceipt } => {
  try {
    const candidate = cloneSendReceipt(receipt);
    const bytes = completedReceiptBytes(candidate);
    if (bytes <= reservation) return { bytes, receipt: candidate };
  } catch {
    // A canonical route receipt cannot reach this defensive invariant fallback.
  }
  const fallback: SendReceipt = {
    deliveryNoticeId: "00000000-0000-4000-8000-000000000000",
    deliveryStatus: "uncertain",
    id: id.message("idempotency-receipt-overflow"),
    rejectedRecipients: [],
    submittedAt: "1970-01-01T00:00:00.000Z",
  };
  return { bytes: completedReceiptBytes(fallback), receipt: fallback };
};
