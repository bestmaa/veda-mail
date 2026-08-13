import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  archiveMigratedSecurityAuditFile,
  readSecurityAuditFile,
} from "@/server/security-audit/security-audit-file";
import { assertSecurityAuditIntegrity } from
  "@/server/security-audit/security-audit-integrity";
import { securityAuditSubkey } from
  "@/server/security-audit/security-audit-key";
import {
  emptySecurityAuditFile,
  type EncryptedSecurityAudit,
  encryptedSecurityAuditSchema,
  type SecurityAuditFile,
  securityAuditFileSchema,
} from "@/server/security-audit/security-audit-record";
import { sharedRecordRepository } from
  "@/server/shared-state/shared-record-repository";

const AAD = Buffer.from("veda-mail/security-audit/shared-record/v1", "utf8");
let migrationPromise: Promise<boolean> | undefined;

const encrypt = (value: SecurityAuditFile): EncryptedSecurityAudit => {
  const canonical = securityAuditFileSchema.parse(value);
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm", securityAuditSubkey("shared-encryption"), iv,
  );
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(canonical), "utf8"), cipher.final(),
  ]);
  return {
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
};

const decrypt = (value: EncryptedSecurityAudit): SecurityAuditFile => {
  const decipher = createDecipheriv(
    "aes-256-gcm", securityAuditSubkey("shared-encryption"),
    Buffer.from(value.iv, "base64url"),
  );
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = securityAuditFileSchema.parse(JSON.parse(plaintext));
  if (JSON.stringify(parsed) !== plaintext) {
    throw new Error("The shared security audit record is not canonical.");
  }
  if (parsed.entries.length > 0) assertSecurityAuditIntegrity(parsed);
  return parsed;
};

export const ensureSecurityAuditMigrated = (): Promise<boolean> => {
  if (!sharedRecordRepository.configured()) return Promise.resolve(false);
  migrationPromise ??= sharedRecordRepository.ensureMigrated(
    "security-audit",
    async () => {
      const file = await readSecurityAuditFile();
      if (file.entries.length === 0) return null;
      assertSecurityAuditIntegrity(file);
      return JSON.stringify(encrypt(file));
    },
    archiveMigratedSecurityAuditFile,
  );
  return migrationPromise;
};

export const sharedSecurityAudit = async () => {
  const serializedRecord = await sharedRecordRepository.get("security-audit");
  const encrypted = serializedRecord
    ? encryptedSecurityAuditSchema.parse(JSON.parse(serializedRecord))
    : null;
  return {
    file: encrypted ? decrypt(encrypted) : emptySecurityAuditFile(),
    serializedRecord,
  };
};

export const replaceSharedSecurityAudit = async (
  current: Awaited<ReturnType<typeof sharedSecurityAudit>>,
  updated: SecurityAuditFile,
): Promise<boolean> => sharedRecordRepository.compareAndSet(
  "security-audit",
  current.serializedRecord,
  JSON.stringify(encrypt(updated)),
);
