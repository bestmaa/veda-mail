import "server-only";

import type { ContactOwner } from "@/domain/member/contact";
import {
  contactOwnerKey,
  decryptContactBook,
  encryptContactBook,
} from "@/server/contacts/contact-crypto";
import {
  archiveMigratedContactFile,
  readContactFile,
} from "@/server/contacts/contact-file";
import {
  emptyContactBook,
  encryptedContactBookSchema,
  type StoredContactBook,
} from "@/server/contacts/contact-record";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";

let migrationPromise: Promise<boolean> | undefined;

export const sharedContactsConfigured = sharedOwnerRepository.configured;

export const ensureContactsMigrated = (): Promise<boolean> => {
  if (!sharedOwnerRepository.configured()) return Promise.resolve(false);
  migrationPromise ??= sharedOwnerRepository.ensureMigrated(
    "contacts",
    async () => {
      const file = await readContactFile();
      return Object.fromEntries(Object.entries(file.owners)
        .map(([owner, value]) => [owner, JSON.stringify(value)]));
    },
    archiveMigratedContactFile,
  );
  return migrationPromise;
};

export const sharedContactBook = async (
  owner: ContactOwner,
  sessionSecret: string,
) => {
  const ownerKey = contactOwnerKey(owner, sessionSecret);
  const serializedRecord = await sharedOwnerRepository.get("contacts", ownerKey);
  const encrypted = serializedRecord
    ? encryptedContactBookSchema.parse(JSON.parse(serializedRecord))
    : undefined;
  return {
    book: encrypted
      ? decryptContactBook(encrypted, ownerKey, sessionSecret)
      : emptyContactBook(),
    ownerKey,
    serializedRecord,
  };
};

export const replaceSharedContactBook = async (
  current: Awaited<ReturnType<typeof sharedContactBook>>,
  updated: StoredContactBook,
  sessionSecret: string,
  empty: boolean,
): Promise<boolean> => sharedOwnerRepository.compareAndSet(
  "contacts",
  current.ownerKey,
  current.serializedRecord,
  empty
    ? null
    : JSON.stringify(encryptContactBook(
      updated, current.ownerKey, sessionSecret,
    )),
);
