import "server-only";

import type { SendMessageInput, SendReceipt } from "@/domain/mail/mail";
import { MessageDeliveryRejectedError } from "@/domain/mail/mail-errors";

type DeliveryReceipt = Pick<
  SendReceipt,
  "deliveryStatus" | "rejectedRecipients"
>;

const PRE_SUBMISSION_ERROR_CODES = new Set([
  "EAUTH",
  "ECONFIG",
  "EDNS",
  "EENVELOPE",
  "EMESSAGE",
  "ENOAUTH",
  "EOAUTH2",
  "EPROXY",
  "EREQUIRETLS",
  "ETLS",
]);

const PRE_SUBMISSION_COMMANDS = new Map([
  ["ECONNECTION", new Set(["API", "EHLO"])],
  ["EPROTOCOL", new Set(["HELO", "LHLO"])],
]);

const submittedRecipients = (
  input: SendMessageInput,
): readonly string[] => {
  const recipients: string[] = [];
  const seen = new Set<string>();
  for (const { email } of [...input.to, ...input.cc, ...input.bcc]) {
    const value = email.trim();
    const key = value.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recipients.push(value);
  }
  return recipients;
};

const rejectedRecipientKeys = (providerResult: unknown): ReadonlySet<string> => {
  if (
    !providerResult ||
    typeof providerResult !== "object" ||
    !("rejected" in providerResult)
  ) {
    return new Set();
  }
  const rejected = providerResult.rejected;
  if (!Array.isArray(rejected)) return new Set();
  return new Set(
    rejected.flatMap((value) =>
      typeof value === "string" && value.trim()
        ? [value.trim().toLowerCase()]
        : [],
    ),
  );
};

const providerString = (
  providerResult: unknown,
  property: "code" | "command",
): string | null => {
  try {
    if (!providerResult || typeof providerResult !== "object") return null;
    const value = Reflect.get(providerResult, property);
    if (typeof value !== "string" || value.length > 64) return null;
    const normalized = value.trim().toUpperCase();
    return normalized || null;
  } catch {
    return null;
  }
};

export const smtpDeliveryReceipt = (
  input: SendMessageInput,
  providerResult: unknown,
): DeliveryReceipt => {
  const submitted = submittedRecipients(input);
  const rejectedKeys = rejectedRecipientKeys(providerResult);
  const rejectedRecipients = submitted.filter((recipient) =>
    rejectedKeys.has(recipient.toLowerCase()),
  );
  if (
    submitted.length > 0 &&
    rejectedRecipients.length === submitted.length
  ) {
    throw new MessageDeliveryRejectedError();
  }
  const code = providerString(providerResult, "code");
  const command = providerString(providerResult, "command");
  if (
    code &&
    (PRE_SUBMISSION_ERROR_CODES.has(code) ||
      (command && PRE_SUBMISSION_COMMANDS.get(code)?.has(command)))
  ) {
    throw new Error("SMTP could not submit the outgoing message.");
  }
  return {
    deliveryStatus: rejectedRecipients.length > 0 ? "partial" : "accepted",
    rejectedRecipients,
  };
};
