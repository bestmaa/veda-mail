import "server-only";

import {
  type ContactBook,
  type ContactOwner,
  type ContactPutOperation,
  type RecentRecipientInput,
} from "@/domain/member/contact";
import { installationStore } from "@/server/installation/installation.store";
import {
  addRecentRecipients,
  updateContactBook,
} from "@/server/contacts/contact-book";
import {
  contactOwnerKey,
  decryptContactBook,
  encryptContactBook,
} from "@/server/contacts/contact-crypto";
import {
  readContactFile,
  writeContactFile,
} from "@/server/contacts/contact-file";
import {
  emptyContactBook,
  MAX_CONTACT_OWNERS,
  type StoredContactBook,
} from "@/server/contacts/contact-record";
import {
  ensureContactsMigrated,
  replaceSharedContactBook,
  sharedContactBook,
} from "@/server/contacts/contact-shared-store";
import { ApiError } from "@/transport/http/api-error";

const globalState = globalThis as typeof globalThis & {
  __vedaMailContactQueue?: Promise<void>;
};
globalState.__vedaMailContactQueue ??= Promise.resolve();
const SHARED_RETRY_LIMIT = 5;

const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailContactQueue!.then(task, task);
  globalState.__vedaMailContactQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const unavailable = (): never => {
  throw new ApiError(
    "Contacts are temporarily unavailable.",
    "CONTACT_STORE_UNAVAILABLE",
    500,
  );
};

const secret = async (): Promise<string> => {
  let installation;
  try {
    installation = await installationStore.get();
  } catch {
    return unavailable();
  }
  if (!installation) {
    throw new ApiError(
      "Complete setup before managing contacts.",
      "SETUP_REQUIRED",
      503,
    );
  }
  return installation.sessionSecret;
};

const conflict = (): never => {
  throw new ApiError(
    "Contacts changed in another session. Reload and try again.",
    "CONTACT_BOOK_CONFLICT",
    409,
  );
};

const sharedMode = async (): Promise<boolean> => {
  try { return await ensureContactsMigrated(); }
  catch { return unavailable(); }
};

const currentBook = async (owner: ContactOwner, sessionSecret: string) => {
  try {
    const file = await readContactFile();
    const ownerKey = contactOwnerKey(owner, sessionSecret);
    const encrypted = file.owners[ownerKey];
    return {
      book: encrypted
        ? decryptContactBook(encrypted, ownerKey, sessionSecret)
        : emptyContactBook(),
      file,
      ownerKey,
    };
  } catch {
    return unavailable();
  }
};

const assertRevision = (
  book: ContactBook,
  expectedRevision: string | null,
): void => {
  if (book.revision !== expectedRevision) conflict();
};

const assertOwnerCapacity = (
  owners: Readonly<Record<string, unknown>>,
  ownerKey: string,
): void => {
  if (owners[ownerKey] === undefined &&
      Object.keys(owners).length >= MAX_CONTACT_OWNERS) {
    throw new ApiError(
      "The installation cannot store another contact owner.",
      "CONTACT_OWNER_LIMIT_REACHED",
      507,
    );
  }
};

const isEmpty = (book: ContactBook): boolean =>
  book.contacts.length === 0 &&
  book.groups.length === 0 &&
  book.recents.length === 0;

const persist = async (
  current: Awaited<ReturnType<typeof currentBook>>,
  updated: StoredContactBook,
  sessionSecret: string,
): Promise<ContactBook> => {
  const owners = { ...current.file.owners };
  if (isEmpty(updated)) delete owners[current.ownerKey];
  else {
    owners[current.ownerKey] = encryptContactBook(
      updated,
      current.ownerKey,
      sessionSecret,
    );
  }
  try {
    await writeContactFile({
      ...current.file,
      owners,
      updatedAt: updated.updatedAt,
    });
  } catch {
    return unavailable();
  }
  return isEmpty(updated) ? emptyContactBook() : updated;
};

export const contactStore = {
  async get(owner: ContactOwner): Promise<ContactBook> {
    const sessionSecret = await secret();
    try {
      return await sharedMode()
        ? (await sharedContactBook(owner, sessionSecret)).book
        : (await currentBook(owner, sessionSecret)).book;
    } catch {
      return unavailable();
    }
  },

  async put(
    owner: ContactOwner,
    operation: ContactPutOperation,
  ): Promise<ContactBook> {
    return serialized(async () => {
      const sessionSecret = await secret();
      if (await sharedMode()) {
        let current;
        try { current = await sharedContactBook(owner, sessionSecret); }
        catch { return unavailable(); }
        assertRevision(current.book, operation.expectedRevision);
        let updated: StoredContactBook;
        try { updated = updateContactBook(current.book, operation); }
        catch (error) {
          if (error instanceof ApiError) throw error;
          return unavailable();
        }
        let replaced;
        try {
          replaced = await replaceSharedContactBook(
            current, updated, sessionSecret, isEmpty(updated),
          );
        } catch { return unavailable(); }
        if (!replaced) conflict();
        return isEmpty(updated) ? emptyContactBook() : updated;
      }
      const current = await currentBook(owner, sessionSecret);
      assertRevision(current.book, operation.expectedRevision);
      assertOwnerCapacity(current.file.owners, current.ownerKey);
      let updated: StoredContactBook;
      try {
        updated = updateContactBook(current.book, operation);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        return unavailable();
      }
      return persist(current, updated, sessionSecret);
    });
  },

  async recordRecents(
    owner: ContactOwner,
    recipients: readonly RecentRecipientInput[],
  ): Promise<ContactBook> {
    if (recipients.length === 0) return contactStore.get(owner);
    return serialized(async () => {
      const sessionSecret = await secret();
      if (await sharedMode()) {
        for (let attempt = 0; attempt < SHARED_RETRY_LIMIT; attempt += 1) {
          let current;
          try { current = await sharedContactBook(owner, sessionSecret); }
          catch { return unavailable(); }
          let updated: StoredContactBook;
          try { updated = addRecentRecipients(current.book, recipients); }
          catch { return unavailable(); }
          try {
            if (await replaceSharedContactBook(
              current, updated, sessionSecret, isEmpty(updated),
            )) return isEmpty(updated) ? emptyContactBook() : updated;
          } catch { return unavailable(); }
        }
        return unavailable();
      }
      const current = await currentBook(owner, sessionSecret);
      assertOwnerCapacity(current.file.owners, current.ownerKey);
      let updated: StoredContactBook;
      try {
        updated = addRecentRecipients(current.book, recipients);
      } catch {
        return unavailable();
      }
      return persist(current, updated, sessionSecret);
    });
  },
};
