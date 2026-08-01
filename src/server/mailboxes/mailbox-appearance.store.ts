import "server-only";

import type {
  Mailbox,
  MailboxAppearanceOwner,
  MailboxColor,
} from "@/domain/mail/mailbox";
import type { MailboxId } from "@/domain/shared/brand";
import { installationStore } from "@/server/installation/installation.store";
import {
  decryptMailboxAppearanceBook,
  encryptMailboxAppearanceBook,
  mailboxAppearanceOwnerKey,
} from "@/server/mailboxes/mailbox-appearance-crypto";
import {
  readMailboxAppearanceFile,
  writeMailboxAppearanceFile,
} from "@/server/mailboxes/mailbox-appearance-file";
import {
  emptyMailboxAppearanceBook,
  type StoredMailboxAppearanceBook,
} from "@/server/mailboxes/mailbox-appearance-record";
import { ApiError } from "@/transport/http/api-error";

const globalState = globalThis as typeof globalThis & {
  __vedaMailMailboxAppearanceQueue?: Promise<void>;
};
globalState.__vedaMailMailboxAppearanceQueue ??= Promise.resolve();

const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailMailboxAppearanceQueue!.then(task, task);
  globalState.__vedaMailMailboxAppearanceQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const unavailable = (): never => {
  throw new ApiError(
    "Mailbox colors are temporarily unavailable.",
    "MAILBOX_APPEARANCE_UNAVAILABLE",
    500,
  );
};

const sessionSecret = async (): Promise<string> => {
  try {
    const installation = await installationStore.get();
    return installation?.sessionSecret ?? unavailable();
  } catch {
    return unavailable();
  }
};

const current = async (owner: MailboxAppearanceOwner, secret: string) => {
  try {
    const file = await readMailboxAppearanceFile();
    const ownerKey = mailboxAppearanceOwnerKey(owner, secret);
    const encrypted = file.owners[ownerKey];
    return {
      book: encrypted
        ? decryptMailboxAppearanceBook(encrypted, ownerKey, secret)
        : emptyMailboxAppearanceBook(),
      file,
      ownerKey,
    };
  } catch {
    return unavailable();
  }
};

const write = async (
  owner: MailboxAppearanceOwner,
  update: (book: StoredMailboxAppearanceBook) => Readonly<Record<string, MailboxColor>>,
): Promise<void> => serialized(async () => {
  const secret = await sessionSecret();
  const value = await current(owner, secret);
  const updated: StoredMailboxAppearanceBook = {
    colors: update(value.book),
    updatedAt: new Date().toISOString(),
    version: 1,
  };
  try {
    await writeMailboxAppearanceFile({
      ...value.file,
      owners: {
        ...value.file.owners,
        [value.ownerKey]: encryptMailboxAppearanceBook(updated, value.ownerKey, secret),
      },
      updatedAt: updated.updatedAt,
    });
  } catch {
    unavailable();
  }
});

export const mailboxAppearanceStore = {
  async decorate(
    owner: MailboxAppearanceOwner,
    mailboxes: readonly Mailbox[],
  ): Promise<readonly Mailbox[]> {
    const secret = await sessionSecret();
    const { book } = await current(owner, secret);
    return mailboxes.map((mailbox) => ({
      ...mailbox,
      color: book.colors[mailbox.id] ?? mailbox.color,
    }));
  },

  remove(owner: MailboxAppearanceOwner, mailboxId: MailboxId): Promise<void> {
    return write(owner, (book) => {
      const colors = { ...book.colors };
      delete colors[mailboxId];
      return colors;
    });
  },

  set(
    owner: MailboxAppearanceOwner,
    mailboxId: MailboxId,
    color: MailboxColor | undefined,
    previousMailboxId?: MailboxId,
  ): Promise<void> {
    return write(owner, (book) => {
      const colors = { ...book.colors };
      const previousColor = previousMailboxId
        ? colors[previousMailboxId]
        : undefined;
      if (previousMailboxId && previousMailboxId !== mailboxId) {
        delete colors[previousMailboxId];
      }
      const nextColor = color ?? previousColor;
      if (nextColor) colors[mailboxId] = nextColor;
      return colors;
    });
  },
};
