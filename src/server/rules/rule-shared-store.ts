import "server-only";

import {
  decryptRuleBook,
  encryptRuleBook,
  ruleOwnerKey,
} from "@/server/rules/rule-crypto";
import {
  archiveMigratedRuleFile,
  readRuleFile,
} from "@/server/rules/rule-file";
import { assertRuleKeyCheck } from "@/server/rules/rule-key";
import {
  encryptedRuleBookSchema,
  type MailRuleOwner,
  type StoredRuleBook,
} from "@/server/rules/rule-record";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";

let migrationPromise: Promise<boolean> | undefined;

export const ensureRulesMigrated = (): Promise<boolean> => {
  if (!sharedOwnerRepository.configured()) return Promise.resolve(false);
  migrationPromise ??= sharedOwnerRepository.ensureMigrated(
    "mail-rules",
    async () => {
      const file = await readRuleFile();
      if (file.keyCheck) assertRuleKeyCheck(file.keyCheck);
      return Object.fromEntries(Object.entries(file.owners)
        .map(([owner, value]) => [owner, JSON.stringify(value)]));
    },
    archiveMigratedRuleFile,
  );
  return migrationPromise;
};

export const sharedRuleBook = async (owner: MailRuleOwner) => {
  const ownerKey = ruleOwnerKey(owner);
  const serializedRecord = await sharedOwnerRepository.get(
    "mail-rules", ownerKey,
  );
  const encrypted = serializedRecord
    ? encryptedRuleBookSchema.parse(JSON.parse(serializedRecord))
    : undefined;
  return {
    book: encrypted ? decryptRuleBook(encrypted, ownerKey) : null,
    ownerKey,
    serializedRecord,
  };
};

export const replaceSharedRuleBook = async (
  current: Awaited<ReturnType<typeof sharedRuleBook>>,
  updated: StoredRuleBook,
): Promise<boolean> => sharedOwnerRepository.compareAndSet(
  "mail-rules",
  current.ownerKey,
  current.serializedRecord,
  JSON.stringify(encryptRuleBook(updated, current.ownerKey)),
);
