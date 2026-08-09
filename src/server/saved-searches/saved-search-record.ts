import "server-only";

import {
  MAX_SAVED_SEARCHES,
  type SavedSearchBook,
} from "@/domain/mail/saved-search";
import { parseMailSearch } from "@/domain/mail/mail-search-parser";
import { id } from "@/domain/shared/brand";
import { savedSearchNameSchema } from "@/server/saved-searches/saved-search-schema";
import { z } from "zod";

export const MAX_SAVED_SEARCH_OWNERS = 10_000;
const timestampSchema = z.string().datetime();
const searchSchema = z.object({
  createdAt: timestampSchema,
  id: z.string().uuid().transform((value) => id.savedSearch(value.toLowerCase())),
  name: savedSearchNameSchema,
  query: z.string().min(1).transform((value, context) => {
    try {
      const canonical = parseMailSearch(value).canonical;
      if (canonical !== value) context.addIssue({ code: "custom", message: "Stored query is not canonical." });
      return canonical;
    } catch {
      context.addIssue({ code: "custom", message: "Stored query is invalid." });
      return z.NEVER;
    }
  }),
  updatedAt: timestampSchema,
  version: z.literal(1),
}).strict();

export const storedSavedSearchBookSchema = z.object({
  createdAt: timestampSchema,
  revision: z.string().min(16).max(200),
  searches: z.array(searchSchema).max(MAX_SAVED_SEARCHES),
  updatedAt: timestampSchema,
  version: z.literal(1),
}).strict().superRefine((book, context) => {
  if (new Set(book.searches.map(({ id: value }) => value)).size !== book.searches.length) {
    context.addIssue({ code: "custom", message: "Saved search IDs must be unique." });
  }
  const names = book.searches.map(({ name }) => name.normalize("NFKC").toLowerCase());
  if (new Set(names).size !== names.length) {
    context.addIssue({ code: "custom", message: "Saved search names must be unique." });
  }
});

const encryptedRecordSchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  ciphertext: z.string().min(1).max(2 * 1024 * 1024),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
}).strict();

export const savedSearchFileSchema = z.object({
  owners: z.record(z.string().regex(/^[A-Za-z0-9_-]{43}$/u), encryptedRecordSchema),
  updatedAt: timestampSchema,
  version: z.literal(1),
}).strict().refine((file) => Object.keys(file.owners).length <= MAX_SAVED_SEARCH_OWNERS,
  "The saved search store contains too many owners.");

export type StoredSavedSearchBook = SavedSearchBook & {
  readonly createdAt: string;
  readonly revision: string;
  readonly updatedAt: string;
};
export type SavedSearchFile = z.infer<typeof savedSearchFileSchema>;
export type EncryptedSavedSearchBook = SavedSearchFile["owners"][string];
export const parseStoredSavedSearchBook = (value: unknown): StoredSavedSearchBook =>
  storedSavedSearchBookSchema.parse(value) as StoredSavedSearchBook;
export const emptySavedSearchBook = (): SavedSearchBook => ({
  createdAt: null, revision: null, searches: [], updatedAt: null, version: 1,
});
