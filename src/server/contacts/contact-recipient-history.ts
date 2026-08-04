import "server-only";

import {
  contactEmailKey,
  type ContactOwner,
  type RecentRecipientInput,
} from "@/domain/member/contact";
import type { SendMessageInput, SendReceipt } from "@/domain/mail/mail";
import { contactStore } from "@/server/contacts/contact-store";

export const confirmedRecentRecipients = (
  input: Pick<SendMessageInput, "bcc" | "cc" | "to">,
  receipt: SendReceipt,
): readonly RecentRecipientInput[] => {
  if (receipt.deliveryStatus === "uncertain") return [];
  const rejected = new Set(
    receipt.rejectedRecipients.map((email) => contactEmailKey(email)),
  );
  const recipients = new Map<string, RecentRecipientInput>();
  for (const recipient of [...input.to, ...input.cc, ...input.bcc]) {
    const key = contactEmailKey(recipient.email);
    if (!rejected.has(key) && !recipients.has(key)) {
      recipients.set(key, {
        email: recipient.email,
        name: recipient.name?.trim() || null,
      });
    }
  }
  return [...recipients.values()];
};

export const recordConfirmedRecentRecipients = async (
  owner: ContactOwner,
  input: Pick<SendMessageInput, "bcc" | "cc" | "to">,
  receipt: SendReceipt,
): Promise<void> => {
  const recipients = confirmedRecentRecipients(input, receipt);
  if (recipients.length > 0) {
    await contactStore.recordRecents(owner, recipients);
  }
};
