import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { securityAuditSubkey } from "@/server/security-audit/security-audit-key";
import type {
  SecurityAuditEntry,
  SecurityAuditFile,
} from "@/server/security-audit/security-audit-record";

const hmac = (context: string, value: unknown): string =>
  createHmac("sha256", securityAuditSubkey(context))
    .update(JSON.stringify(value), "utf8")
    .digest("base64url");

const equalDigest = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "base64url");
  const rightBytes = Buffer.from(right, "base64url");
  return leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes);
};

export const securityAuditDigestsEqual = equalDigest;

const entryPayload = (entry: Omit<SecurityAuditEntry, "integrity">) => ({
  action: entry.action,
  actorId: entry.actorId,
  actorType: entry.actorType,
  at: entry.at,
  count: entry.count,
  id: entry.id,
  outcome: entry.outcome,
  previousIntegrity: entry.previousIntegrity,
  requestId: entry.requestId,
  sequence: entry.sequence,
  targetId: entry.targetId,
  targetType: entry.targetType,
});

const storedEntryPayload = (entry: SecurityAuditEntry) => ({
  ...entryPayload(entry),
  integrity: entry.integrity,
});

export const securityAuditEntryIntegrity = (
  entry: Omit<SecurityAuditEntry, "integrity">,
): string => hmac("entry-chain", entryPayload(entry));

const filePayload = (file: Omit<SecurityAuditFile, "integrity">) => ({
  anchor: file.anchor,
  droppedCount: file.droppedCount,
  entries: file.entries.map(storedEntryPayload),
  keyCheck: file.keyCheck,
  nextSequence: file.nextSequence,
  updatedAt: file.updatedAt,
  version: file.version,
});

export const securityAuditFileIntegrity = (
  file: Omit<SecurityAuditFile, "integrity">,
): string => hmac("file-integrity", filePayload(file));

export const assertSecurityAuditIntegrity = (file: SecurityAuditFile): void => {
  if (!file.integrity || !file.keyCheck || !file.anchor) {
    throw new Error("The security audit store is incomplete.");
  }
  const { integrity, ...payload } = file;
  if (!equalDigest(integrity, securityAuditFileIntegrity(payload))) {
    throw new Error("The security audit store integrity check failed.");
  }
  let previous = file.anchor;
  let expectedSequence = file.droppedCount + 1;
  for (const entry of file.entries) {
    const { integrity: entryIntegrity, ...entryValue } = entry;
    if (entry.sequence !== expectedSequence ||
        !equalDigest(entry.previousIntegrity, previous) ||
        !equalDigest(entryIntegrity, securityAuditEntryIntegrity(entryValue))) {
      throw new Error("The security audit chain integrity check failed.");
    }
    previous = entryIntegrity;
    expectedSequence += 1;
  }
  if (file.nextSequence !== expectedSequence) {
    throw new Error("The security audit sequence is invalid.");
  }
};
