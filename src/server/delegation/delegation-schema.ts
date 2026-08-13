import "server-only";

import { z } from "zod";

import type { DelegationUpdate } from "@/domain/mail/delegation";

const identifier = z.string().trim().min(1).max(320)
  .refine((value) => new TextEncoder().encode(value).byteLength <= 320,
    "The account identifier is too long.")
  .refine((value) => [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code > 31 && (code < 127 || code > 159);
  }),
    "The account identifier contains control characters.")
  .refine((value) => !value.startsWith("-")
    && !["anyone", "anonymous"].includes(value.toLowerCase()),
  "Reserved identities cannot be delegated.");

const updateSchema = z.object({
  access: z.enum(["manage", "read"]),
  identifier,
}).strict();

const deleteSchema = z.object({ identifier }).strict();

export const parseDelegationUpdate = (value: unknown): DelegationUpdate =>
  updateSchema.parse(value);
export const parseDelegationDelete = (value: unknown): string =>
  deleteSchema.parse(value).identifier;
