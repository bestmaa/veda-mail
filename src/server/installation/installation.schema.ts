import "server-only";

import { z } from "zod";

import { DEFAULT_PUBLIC_REPOSITORY_URL } from "@/domain/installation/installation";
import { mailServiceProfileSchema } from "@/server/mail-service/mail-service-profile.schema";

const httpsUrlSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Repository URL must use HTTPS.",
  });

export const adminUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(64)
  .regex(
    /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/,
    "Use letters, numbers, dots, underscores, or hyphens.",
  );

export const adminPasswordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(1024)
  .refine((value) => /[a-zA-Z]/.test(value) && /\d/.test(value), {
    message: "Password must contain a letter and a number.",
  });

export const organizationBrandingInputSchema = z
  .object({
    accentColor: z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/),
    logoFileName: z
      .string()
      .regex(/^branding\/logo(?:-[a-f0-9]{64})?\.webp$/)
      .nullable(),
    organizationName: z.string().trim().min(2).max(120),
    primaryColor: z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/),
    productName: z.string().trim().min(2).max(80),
    publicRepositoryUrl: httpsUrlSchema.nullable(),
  })
  .strict();

export const setupInputSchema = z
  .object({
    accentColor: z.string(),
    adminPassword: adminPasswordSchema,
    adminUsername: adminUsernameSchema,
    organizationName: z.string(),
    primaryColor: z.string(),
    productName: z.string(),
    publicRepositoryUrl: z
      .union([httpsUrlSchema, z.literal("")])
      .default(DEFAULT_PUBLIC_REPOSITORY_URL)
      .transform((value) => value || null),
    setupToken: z.string().min(1).max(1024),
  })
  .strict();

export const passwordDigestSchema = z
  .object({
    algorithm: z.literal("scrypt"),
    digest: z.string().min(1),
    salt: z.string().min(1),
  })
  .strict();

export const installationRecordSchema = z
  .object({
    installedAt: z.string().datetime(),
    mailProfile: mailServiceProfileSchema,
    organization: organizationBrandingInputSchema,
    owner: z
      .object({
        authVersion: z.number().int().positive(),
        password: passwordDigestSchema,
        updatedAt: z.string().datetime(),
        username: adminUsernameSchema,
      })
      .strict(),
    sessionSecret: z.string().min(43),
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict();

export const adminLoginSchema = z
  .object({
    password: z.string().min(1).max(1024),
    username: adminUsernameSchema,
  })
  .strict();

export const adminAccountUpdateSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: adminPasswordSchema.optional(),
    username: adminUsernameSchema,
  })
  .strict();
