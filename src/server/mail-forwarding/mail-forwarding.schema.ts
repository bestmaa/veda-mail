import "server-only";

import { domainToASCII } from "node:url";
import { z } from "zod";

export const forwardingEmailSchema = z.string().trim().email().max(320)
  .transform((value) => {
    const at = value.lastIndexOf("@");
    return `${value.slice(0, at)}@${domainToASCII(
      value.slice(at + 1).toLowerCase().replace(/\.$/u, ""),
    )}`;
  });

export const mailForwardingConfigurationSchema = z.object({
  destinationEmail: forwardingEmailSchema,
  keepLocalCopy: z.literal(true),
  sourceAddresses: z.array(forwardingEmailSchema).min(1).max(101),
  sourceEmail: forwardingEmailSchema,
  status: z.enum(["active", "applying", "error"]),
  updatedAt: z.string().datetime(),
}).strict();

export const mailForwardingLedgerSchema = z.object({
  entries: z.array(mailForwardingConfigurationSchema).max(5_000),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  updatedAt: z.string().datetime(),
  version: z.literal(1),
}).strict().superRefine((value, context) => {
  const sources = new Set<string>();
  for (const entry of value.entries) {
    if (!entry.sourceAddresses.some((address) =>
      address.toLowerCase() === entry.sourceEmail.toLowerCase())) {
      context.addIssue({ code: "custom", message: "Primary source address is missing." });
    }
    for (const address of entry.sourceAddresses) {
      const key = address.toLowerCase();
      if (sources.has(key)) {
        context.addIssue({ code: "custom", message: "Duplicate forwarding source." });
      }
      sources.add(key);
    }
  }
});

const stepUp = {
  currentAdminPassword: z.string().min(1).max(1_024),
  otpCode: z.string().trim().min(1).max(64).optional(),
};

export const mailForwardingPutSchema = z.object({
  ...stepUp,
  confirmDestinationEmail: forwardingEmailSchema,
  destinationEmail: forwardingEmailSchema,
  expectedRevision: z.number().int().nonnegative(),
}).strict().refine(
  (value) => value.destinationEmail === value.confirmDestinationEmail,
  { message: "The forwarding destinations do not match.", path: ["confirmDestinationEmail"] },
);

export const mailForwardingDeleteSchema = z.object({
  ...stepUp,
  expectedRevision: z.number().int().nonnegative(),
}).strict();

export type MailForwardingLedger = z.infer<typeof mailForwardingLedgerSchema>;
