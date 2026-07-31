import "server-only";

import { domainToASCII } from "node:url";
import { z } from "zod";

const normalizedDomain = z.string().transform((value, context) => {
  const domain = domainToASCII(value.trim().toLowerCase().replace(/\.$/, ""));
  const labels = domain.split(".");
  if (
    domain.length > 253 ||
    labels.length < 2 ||
    !labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    context.addIssue({ code: "custom", message: "Enter a valid email domain." });
    return z.NEVER;
  }
  return domain;
});

const email = z
  .string()
  .trim()
  .email("Enter a valid mailbox email address.")
  .max(320)
  .transform((value) => {
    const separator = value.lastIndexOf("@");
    return `${value.slice(0, separator)}@${domainToASCII(
      value.slice(separator + 1).toLowerCase().replace(/\.$/, ""),
    )}`;
  });

const mailboxPassword = z
  .string()
  .min(12, "The initial mailbox password must be at least 12 characters.")
  .max(1000)
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    message: "The initial mailbox password must contain a letter and a number.",
  });

export const adminMailUserCreateSchema = z
  .object({
    confirmPassword: z.string().max(1000),
    currentAdminPassword: z.string().min(1).max(1024),
    displayName: z.string().trim().min(1).max(120).optional(),
    email,
    otpCode: z.string().trim().min(1).max(64).optional(),
    password: mailboxPassword,
  })
  .strict()
  .refine((input) => input.password === input.confirmPassword, {
    message: "The mailbox passwords do not match.",
    path: ["confirmPassword"],
  });

export const adminMailUserListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    domain: normalizedDomain.optional(),
    search: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const adminMailUserDetailQuerySchema = z
  .object({ domain: normalizedDomain })
  .strict();

export const adminMailUserIdSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      value.trim() === value &&
      !value.includes("/") &&
      ![...value].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      }),
    "Invalid mailbox user identifier.",
  );

export const adminMailUserIdempotencyKeySchema = z
  .string()
  .uuid("Send a UUID Idempotency-Key header.");

export const parseStrictSearchParams = (
  url: string,
): Record<string, string> => {
  const entries: Record<string, string> = {};
  for (const [name, value] of new URL(url).searchParams) {
    if (Object.hasOwn(entries, name)) {
      throw new z.ZodError([
        { code: "custom", message: `Query parameter ${name} must appear once.`, path: [name] },
      ]);
    }
    entries[name] = value;
  }
  return entries;
};

export const emailDomain = (value: string): string =>
  value.slice(value.lastIndexOf("@") + 1);
