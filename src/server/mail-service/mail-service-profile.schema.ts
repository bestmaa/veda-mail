import "server-only";

import { domainToASCII } from "node:url";
import { z } from "zod";

import { id } from "@/domain/shared/brand";

const normalizeDomain = (value: string): string =>
  domainToASCII(value.trim().toLowerCase().replace(/\.$/, ""));

const mailDomainSchema = z.string().transform((value, context) => {
  const domain = normalizeDomain(value);
  const labels = domain.split(".");
  const isValid =
    domain.length <= 253 &&
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    );
  if (!isValid) {
    context.addIssue({
      code: "custom",
      message: "Enter a valid email domain.",
    });
    return z.NEVER;
  }
  return domain;
});

export const mailServiceProfileInputSchema = z
  .object({
    allowedDomains: z
      .array(mailDomainSchema)
      .min(1, "Add at least one email domain.")
      .max(100)
      .transform((domains) => [...new Set(domains)]),
    config: z.record(z.string().max(100), z.string().max(4096)),
    displayName: z.string().trim().min(2).max(80),
    providerId: z.string().trim().min(1).max(80).transform(id.provider),
  })
  .strict();

export const mailServiceProfileSchema = mailServiceProfileInputSchema.extend({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.literal(1),
});

export const memberCredentialsSchema = z
  .object({
    email: z.string().trim().email().max(320).transform((value) => {
      const separator = value.lastIndexOf("@");
      const localPart = value.slice(0, separator);
      const domain = normalizeDomain(value.slice(separator + 1));
      return `${localPart}@${domain}`;
    }),
    otpCode: z.string().trim().regex(/^\d{6}$/).optional(),
    password: z.string().min(1).max(1024),
  })
  .strict();

export const emailDomain = (email: string): string =>
  email.slice(email.lastIndexOf("@") + 1);
