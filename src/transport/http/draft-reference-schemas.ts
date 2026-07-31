import { hasHeaderControlCharacter } from "@/domain/mail/header-safety";
import { id } from "@/domain/shared/brand";
import { z } from "zod";

export const composeDraftIdSchema = z
  .string()
  .uuid("The compose draft identifier is invalid.")
  .transform((value) => id.draft(value.toLowerCase()));

export const providerDraftIdSchema = z
  .string()
  .min(1, "The saved draft identifier is invalid.")
  .max(255, "The saved draft identifier is invalid.")
  .regex(/^[A-Za-z0-9_-]+$/u, "The saved draft identifier is invalid.")
  .transform(id.providerDraft);

export const draftRevisionSchema = z
  .string()
  .min(1, "The draft revision is invalid.")
  .max(255, "The draft revision is invalid.")
  .refine(
    (value) => value === value.trim() && !hasHeaderControlCharacter(value),
    "The draft revision is invalid.",
  );
