import "server-only";

import {
  type EmailSignatureBook,
  type EmailSignatureCanonicalContent,
  type EmailSignatureOwner,
  type EmailSignaturePutOperation,
} from "@/domain/member/email-signature";
import { installationStore } from "@/server/installation/installation.store";
import { updateEmailSignatureBook } from "@/server/signatures/email-signature-book";
import {
  decryptEmailSignatureBook,
  emailSignatureOwnerKey,
  encryptEmailSignatureBook,
} from "@/server/signatures/email-signature-crypto";
import { canonicalizeEmailSignatureContent } from "@/server/signatures/email-signature-content";
import {
  archiveMigratedEmailSignatureFile,
  readEmailSignatureFile,
  writeEmailSignatureFile,
} from "@/server/signatures/email-signature-file";
import {
  emptyEmailSignatureBook,
  encryptedEmailSignatureBookSchema,
  type StoredEmailSignatureBook,
} from "@/server/signatures/email-signature-record";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";
import { ApiError } from "@/transport/http/api-error";

const globalState = globalThis as typeof globalThis & {
  __vedaMailEmailSignatureQueue?: Promise<void>;
};
globalState.__vedaMailEmailSignatureQueue ??= Promise.resolve();
let migrationPromise: Promise<boolean> | undefined;

const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailEmailSignatureQueue!.then(task, task);
  globalState.__vedaMailEmailSignatureQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const secret = async (): Promise<string> => {
  let installation;
  try {
    installation = await installationStore.get();
  } catch {
    return storeUnavailable();
  }
  if (!installation) {
    throw new ApiError(
      "Complete setup before managing signatures.",
      "SETUP_REQUIRED",
      503,
    );
  }
  return installation.sessionSecret;
};

const storeUnavailable = (): never => {
  throw new ApiError(
    "Email signatures are temporarily unavailable.",
    "SIGNATURE_STORE_UNAVAILABLE",
    500,
  );
};

const conflict = (): never => {
  throw new ApiError(
    "Signatures changed in another session. Reload and try again.",
    "SIGNATURE_BOOK_CONFLICT",
    409,
  );
};

const currentBook = async (
  owner: EmailSignatureOwner,
  sessionSecret: string,
) => {
  try {
    const file = await readEmailSignatureFile();
    const ownerKey = emailSignatureOwnerKey(owner, sessionSecret);
    const encrypted = file.owners[ownerKey];
    return {
      book: encrypted
        ? decryptEmailSignatureBook(encrypted, ownerKey, sessionSecret)
        : emptyEmailSignatureBook(),
      file,
      ownerKey,
    };
  } catch {
    return storeUnavailable();
  }
};

const ensureMigrated = (): Promise<boolean> => {
  if (!sharedOwnerRepository.configured()) return Promise.resolve(false);
  migrationPromise ??= sharedOwnerRepository.ensureMigrated(
    "email-signatures",
    async () => {
      const file = await readEmailSignatureFile();
      return Object.fromEntries(Object.entries(file.owners)
        .map(([owner, value]) => [owner, JSON.stringify(value)]));
    },
    archiveMigratedEmailSignatureFile,
  );
  return migrationPromise;
};

const sharedCurrentBook = async (
  owner: EmailSignatureOwner, sessionSecret: string,
) => {
  const ownerKey = emailSignatureOwnerKey(owner, sessionSecret);
  const serializedRecord = await sharedOwnerRepository.get(
    "email-signatures", ownerKey,
  );
  const encrypted = serializedRecord
    ? encryptedEmailSignatureBookSchema.parse(JSON.parse(serializedRecord))
    : undefined;
  return {
    book: encrypted
      ? decryptEmailSignatureBook(encrypted, ownerKey, sessionSecret)
      : emptyEmailSignatureBook(),
    ownerKey,
    serializedRecord,
  };
};

const assertRevision = (
  book: EmailSignatureBook,
  expected: string | null,
): void => {
  if (book.revision !== expected) conflict();
};

const canonicalContent = (
  operation: EmailSignaturePutOperation,
): EmailSignatureCanonicalContent | null =>
  operation.operation === "create" || operation.operation === "update"
    ? canonicalizeEmailSignatureContent(operation.content)
    : null;

export const emailSignatureStore = {
  async get(owner: EmailSignatureOwner): Promise<EmailSignatureBook> {
    const sessionSecret = await secret();
    try {
      return await ensureMigrated()
        ? (await sharedCurrentBook(owner, sessionSecret)).book
        : (await currentBook(owner, sessionSecret)).book;
    } catch {
      return storeUnavailable();
    }
  },

  async put(
    owner: EmailSignatureOwner,
    operation: EmailSignaturePutOperation,
  ): Promise<EmailSignatureBook> {
    const content = canonicalContent(operation);
    return serialized(async () => {
      const sessionSecret = await secret();
      if (await ensureMigrated()) {
        let current;
        try { current = await sharedCurrentBook(owner, sessionSecret); }
        catch { return storeUnavailable(); }
        assertRevision(current.book, operation.expectedRevision);
        let updated: StoredEmailSignatureBook;
        try {
          updated = updateEmailSignatureBook(current.book, operation, content);
        } catch (error) {
          if (error instanceof ApiError) throw error;
          return storeUnavailable();
        }
        const encrypted = updated.signatures.length === 0
          ? null
          : JSON.stringify(encryptEmailSignatureBook(
            updated, current.ownerKey, sessionSecret,
          ));
        let replaced;
        try {
          replaced = await sharedOwnerRepository.compareAndSet(
            "email-signatures", current.ownerKey,
            current.serializedRecord, encrypted,
          );
        } catch { return storeUnavailable(); }
        if (!replaced) conflict();
        return updated.signatures.length === 0
          ? emptyEmailSignatureBook()
          : updated;
      }
      const current = await currentBook(owner, sessionSecret);
      assertRevision(current.book, operation.expectedRevision);
      let updated: StoredEmailSignatureBook;
      try {
        updated = updateEmailSignatureBook(current.book, operation, content);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        return storeUnavailable();
      }
      try {
        await writeEmailSignatureFile({
          ...current.file,
          owners: {
            ...current.file.owners,
            [current.ownerKey]: encryptEmailSignatureBook(
              updated,
              current.ownerKey,
              sessionSecret,
            ),
          },
          updatedAt: updated.updatedAt,
        });
      } catch {
        return storeUnavailable();
      }
      return updated;
    });
  },
};
