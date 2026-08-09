import {
  MAX_SAVED_SEARCH_NAME_CHARACTERS,
  MAX_SAVED_SEARCH_NAME_UTF8_BYTES,
  type SavedSearchPutOperation,
} from "@/domain/mail/saved-search";
import { parseMailSearch } from "@/domain/mail/mail-search-parser";
import {
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
  outgoingContentUtf8Bytes,
} from "@/domain/mail/outgoing-content-policy";
import { id } from "@/domain/shared/brand";
import { z } from "zod";

export const savedSearchNameSchema = z.string()
  .max(MAX_SAVED_SEARCH_NAME_CHARACTERS, "Saved search name is too long.")
  .refine((value) => outgoingContentUtf8Bytes(value) <= MAX_SAVED_SEARCH_NAME_UTF8_BYTES,
    "Saved search name is too large.")
  .refine((value) => !hasUnpairedContentSurrogate(value),
    "Saved search name must contain valid Unicode.")
  .refine((value) => !hasDisallowedContentControl(value),
    "Saved search name cannot contain unsafe control characters.")
  .refine((value) => !/[\r\n\u2028\u2029]/u.test(value),
    "Saved search name must be one line.")
  .trim().min(1, "Saved search name cannot be blank.");

const savedSearchIdSchema = z.string().uuid("The saved search identifier is invalid.")
  .transform((value) => id.savedSearch(value.toLowerCase()));
const revisionSchema = z.string().trim().min(16).max(200).nullable();
const querySchema = z.string().trim().min(1, "Saved search query cannot be blank.");

const mutationSchema = z.discriminatedUnion("operation", [
  z.object({
    expectedRevision: revisionSchema,
    name: savedSearchNameSchema,
    operation: z.literal("create"),
    query: querySchema,
  }).strict(),
  z.object({
    expectedRevision: revisionSchema,
    name: savedSearchNameSchema,
    operation: z.literal("update"),
    query: querySchema,
    searchId: savedSearchIdSchema,
  }).strict(),
  z.object({
    expectedRevision: revisionSchema,
    operation: z.literal("delete"),
    searchId: savedSearchIdSchema,
  }).strict(),
]);

export const parseSavedSearchPutOperation = (value: unknown): SavedSearchPutOperation => {
  const parsed = mutationSchema.parse(value);
  if (parsed.operation === "delete") return parsed;
  try {
    return { ...parsed, query: parseMailSearch(parsed.query).canonical };
  } catch (error) {
    throw new z.ZodError([{
      code: "custom",
      message: error instanceof Error ? error.message : "Saved search query is invalid.",
      path: ["query"],
    }]);
  }
};
