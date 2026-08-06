import "server-only";

import {
  assertSecurityAuditIntegrity,
  securityAuditDigestsEqual,
  securityAuditEntryIntegrity,
  securityAuditFileIntegrity,
} from "@/server/security-audit/security-audit-integrity";
import {
  securityAuditGenesis,
  securityAuditKeyCheck,
} from "@/server/security-audit/security-audit-key";
import {
  readSecurityAuditFile,
  writeSecurityAuditFile,
} from "@/server/security-audit/security-audit-file";
import {
  MAX_SECURITY_AUDIT_ENTRIES,
  type SecurityAuditAppend,
  type SecurityAuditEntry,
  type SecurityAuditFile,
  securityAuditFileSchema,
} from "@/server/security-audit/security-audit-record";

const globalState = globalThis as typeof globalThis & {
  __vedaMailSecurityAuditQueue?: Promise<void>;
};
globalState.__vedaMailSecurityAuditQueue ??= Promise.resolve();

const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailSecurityAuditQueue!.then(task, task);
  globalState.__vedaMailSecurityAuditQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const verified = async (): Promise<SecurityAuditFile> => {
  const file = await readSecurityAuditFile();
  if (file.entries.length === 0 && file.integrity === null) return file;
  if (!file.keyCheck || !securityAuditDigestsEqual(
    file.keyCheck,
    securityAuditKeyCheck(),
  )) {
    throw new Error("The security audit key does not match the store.");
  }
  assertSecurityAuditIntegrity(file);
  return file;
};

export const appendSecurityAuditFile = (
  current: SecurityAuditFile,
  input: SecurityAuditAppend,
  retentionLimit = MAX_SECURITY_AUDIT_ENTRIES,
): SecurityAuditFile => {
  const anchor = current.anchor ?? securityAuditGenesis();
  const previousIntegrity = current.entries.at(-1)?.integrity ?? anchor;
  const entryValue: Omit<SecurityAuditEntry, "integrity"> = {
    ...input,
    at: new Date().toISOString(),
    id: crypto.randomUUID(),
    previousIntegrity,
    sequence: current.nextSequence,
  };
  const entry: SecurityAuditEntry = {
    ...entryValue,
    integrity: securityAuditEntryIntegrity(entryValue),
  };
  const expanded = [...current.entries, entry];
  const removed = Math.max(0, expanded.length - retentionLimit);
  const entries = expanded.slice(removed);
  const nextAnchor = removed > 0
    ? expanded[removed - 1]!.integrity
    : anchor;
  const payload: Omit<SecurityAuditFile, "integrity"> = {
    anchor: nextAnchor,
    droppedCount: current.droppedCount + removed,
    entries,
    keyCheck: securityAuditKeyCheck(),
    nextSequence: current.nextSequence + 1,
    updatedAt: entry.at,
    version: 1,
  };
  return securityAuditFileSchema.parse({
    ...payload,
    integrity: securityAuditFileIntegrity(payload),
  });
};

export const securityAuditStore = {
  async append(input: SecurityAuditAppend): Promise<SecurityAuditEntry> {
    return serialized(async () => {
      const updated = appendSecurityAuditFile(await verified(), input);
      await writeSecurityAuditFile(updated);
      return updated.entries.at(-1)!;
    });
  },
  async list(input: { readonly beforeSequence?: number; readonly limit?: number } = {}) {
    const file = await verified();
    const limit = Math.min(200, Math.max(1, input.limit ?? 100));
    const entries = input.beforeSequence === undefined
      ? file.entries
      : file.entries.filter(({ sequence }) => sequence < input.beforeSequence!);
    const page = entries.slice(-limit).reverse();
    return {
      droppedCount: file.droppedCount,
      entries: page,
      nextCursor: page.length === limit ? page.at(-1)!.sequence : null,
      verifiedAt: new Date().toISOString(),
    };
  },
};
