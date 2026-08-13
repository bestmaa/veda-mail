import "server-only";

import {
  decryptMemberSecurity,
  encryptMemberSecurity,
  memberSecurityOwnerKey,
} from "@/server/auth/member-two-factor-crypto";
import {
  archiveMigratedMemberSecurityFile,
  readMemberSecurityFile,
} from "@/server/auth/member-two-factor-file";
import {
  encryptedMemberSecuritySchema,
  type MemberSecurity,
} from "@/server/auth/member-two-factor-record";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";

let migrationPromise: Promise<boolean> | undefined;

export const ensureMemberSecurityMigrated = (
  sessionSecret: string,
): Promise<boolean> => {
  if (!sharedOwnerRepository.configured()) return Promise.resolve(false);
  migrationPromise ??= sharedOwnerRepository.ensureMigrated(
    "member-two-factor",
    async () => {
      const file = await readMemberSecurityFile();
      return Object.fromEntries(Object.entries(file.members).map(([email, value]) => {
        const ownerKey = memberSecurityOwnerKey(email, sessionSecret);
        return [ownerKey, JSON.stringify(encryptMemberSecurity(
          value, ownerKey, sessionSecret,
        ))];
      }));
    },
    archiveMigratedMemberSecurityFile,
  );
  return migrationPromise;
};

export const sharedMemberSecurity = async (
  email: string,
  sessionSecret: string,
) => {
  const ownerKey = memberSecurityOwnerKey(email, sessionSecret);
  const serializedRecord = await sharedOwnerRepository.get(
    "member-two-factor", ownerKey,
  );
  const encrypted = serializedRecord
    ? encryptedMemberSecuritySchema.parse(JSON.parse(serializedRecord))
    : undefined;
  return {
    ownerKey,
    security: encrypted
      ? decryptMemberSecurity(encrypted, ownerKey, sessionSecret)
      : null,
    serializedRecord,
  };
};

export const replaceSharedMemberSecurity = async (
  current: Awaited<ReturnType<typeof sharedMemberSecurity>>,
  updated: MemberSecurity | null,
  sessionSecret: string,
): Promise<boolean> => sharedOwnerRepository.compareAndSet(
  "member-two-factor",
  current.ownerKey,
  current.serializedRecord,
  updated === null ? null : JSON.stringify(encryptMemberSecurity(
    updated, current.ownerKey, sessionSecret,
  )),
);
