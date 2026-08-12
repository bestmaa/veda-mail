import "server-only";

import {
  DEFAULT_DATA_RETENTION_POLICY,
  type DataRetentionPolicy,
} from "@/domain/installation/data-retention-policy";
import { dataRetentionPolicyStore } from "@/server/organization/data-retention-policy.store";
import {
  assertSecurityAuditIntegrity,
  securityAuditDigestsEqual,
  securityAuditEntryIntegrity,
  securityAuditFileIntegrity,
} from "@/server/security-audit/security-audit-integrity";
import {
  securityAuditGenesis,
  securityAuditKeyCheck,
  securityAuditSubjectId,
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
  now = new Date(),
): SecurityAuditFile => {
  const anchor = current.anchor ?? securityAuditGenesis();
  const previousIntegrity = current.entries.at(-1)?.integrity ?? anchor;
  const entryValue: Omit<SecurityAuditEntry, "integrity"> = {
    ...input,
    at: now.toISOString(),
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

export const retainSecurityAuditFile = (
  current: SecurityAuditFile,
  policy: DataRetentionPolicy = DEFAULT_DATA_RETENTION_POLICY,
  now = new Date(),
): SecurityAuditFile => {
  if (current.entries.length === 0) return current;
  const cutoff = now.getTime() - policy.securityAuditMaxAgeDays * 86_400_000;
  const firstWithinAge = current.entries.findIndex(({ at }) =>
    new Date(at).getTime() >= cutoff,
  );
  const ageRemoved = firstWithinAge < 0 ? current.entries.length : firstWithinAge;
  const countRemoved = Math.max(
    0,
    current.entries.length - policy.securityAuditMaxEntries,
  );
  const removed = Math.max(ageRemoved, countRemoved);
  if (removed === 0) return current;
  const entries = current.entries.slice(removed);
  const anchor = current.entries[removed - 1]!.integrity;
  const checkpointValue: Omit<SecurityAuditEntry, "integrity"> | null =
    entries.length === 0 ? {
      action: "system.retention.checkpointed",
      actorId: securityAuditSubjectId("actor", "system:retention"),
      actorType: "system",
      at: now.toISOString(),
      count: removed,
      id: crypto.randomUUID(),
      outcome: "success",
      previousIntegrity: anchor,
      requestId: null,
      sequence: current.nextSequence,
      targetId: null,
      targetType: "retention",
    } : null;
  const retainedEntries = checkpointValue ? [{
    ...checkpointValue,
    integrity: securityAuditEntryIntegrity(checkpointValue),
  }] : entries;
  const payload: Omit<SecurityAuditFile, "integrity"> = {
    ...current,
    anchor,
    droppedCount: current.droppedCount + removed,
    entries: retainedEntries,
    nextSequence: current.nextSequence + (checkpointValue ? 1 : 0),
    updatedAt: checkpointValue?.at ?? current.updatedAt,
  };
  return securityAuditFileSchema.parse({
    ...payload,
    integrity: securityAuditFileIntegrity(payload),
  });
};

const retained = async (current: SecurityAuditFile): Promise<SecurityAuditFile> =>
  retainSecurityAuditFile(current, await dataRetentionPolicyStore.get());

export const securityAuditStore = {
  async append(input: SecurityAuditAppend): Promise<SecurityAuditEntry> {
    return serialized(async () => {
      const policy = await dataRetentionPolicyStore.get();
      const updated = retainSecurityAuditFile(
        appendSecurityAuditFile(await verified(), input, policy.securityAuditMaxEntries),
        policy,
      );
      await writeSecurityAuditFile(updated);
      return updated.entries.at(-1)!;
    });
  },
  async applyRetention(): Promise<void> {
    await serialized(async () => {
      const current = await verified();
      const updated = await retained(current);
      if (updated !== current) await writeSecurityAuditFile(updated);
    });
  },
  async list(input: { readonly beforeSequence?: number; readonly limit?: number } = {}) {
    return serialized(async () => {
    const current = await verified();
    const file = await retained(current);
    if (file !== current) await writeSecurityAuditFile(file);
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
    });
  },
};
