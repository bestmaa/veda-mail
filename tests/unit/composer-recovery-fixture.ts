import type { DraftContent } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import type { ComposerRecoveryDatabase } from "@/presentation/features/mail-workspace/composer-recovery-database";
import type { ComposerRecoverySessionStorage } from "@/presentation/features/mail-workspace/composer-recovery-storage";
import type {
  ComposerRecoveryJournal,
  ComposerRecoveryOwner,
  ComposerRecoverySnapshot,
} from "@/presentation/features/mail-workspace/composer-recovery.types";

export const recoveryOwner: ComposerRecoveryOwner = {
  accountId: id.account("account-a"),
  providerId: id.provider("provider-a"),
  sessionExpiresAt: "2026-08-01T00:00:00.000Z",
  sessionScope: "scope-a",
};

export const recoverySnapshot = (
  body = "Latest local body",
): ComposerRecoverySnapshot => ({
  bcc: "unfinished hidden <",
  body: { mode: "plain", text: body },
  cc: '"Unfinished recipient',
  hadLocalAttachments: false,
  inReplyTo: id.message("message-a"),
  signatureDisposition: "none",
  subject: "Raw subject",
  title: "Reply all",
  to: "person@example.com, partial@",
});

const pendingContent = (body: string): DraftContent => ({
  bcc: [], body, cc: [], subject: "Raw subject", to: [],
});

export const recoveryJournal = (
  overrides: Partial<ComposerRecoveryJournal> = {},
): ComposerRecoveryJournal => ({
  composeId: id.draft("11111111-1111-4111-8111-111111111111"),
  localGeneration: 2,
  owner: recoveryOwner,
  pendingSave: {
    composeId: id.draft("11111111-1111-4111-8111-111111111111"),
    content: pendingContent("Issued body"),
    contentGeneration: 1,
  },
  recordId: "22222222-2222-4222-8222-222222222222",
  snapshot: recoverySnapshot(),
  storageRevision: 1,
  updatedAt: "2026-07-31T12:00:00.000Z",
  version: 1,
  ...overrides,
});

export class MemoryRecoveryDatabase implements ComposerRecoveryDatabase {
  public readonly records = new Map<string, unknown>();
  public readonly revokedRecords = new Set<string>();
  public readonly revokedScopes = new Set<string>();
  public onPut: (() => void) | null = null;
  public onRemove: (() => void) | null = null;
  public shouldFail = false;

  public async discoverScope(
    sessionScope: string,
    limit = 64,
  ): Promise<readonly { journal: unknown; recordId: string }[]> {
    if (this.shouldFail) throw new Error("database unavailable");
    return [...this.records.entries()]
      .filter(([, value]) =>
        (value as Partial<ComposerRecoveryJournal>).owner?.sessionScope === sessionScope)
      .sort(([, left], [, right]) => Date.parse(
        (right as Partial<ComposerRecoveryJournal>).updatedAt ?? "",
      ) - Date.parse((left as Partial<ComposerRecoveryJournal>).updatedAt ?? ""))
      .slice(0, Math.max(0, Math.min(64, Math.trunc(limit))))
      .map(([recordId, journal]) => ({ journal, recordId }));
  }

  public async get(recordId: string): Promise<unknown | null> {
    if (this.shouldFail) throw new Error("database unavailable");
    return this.records.get(recordId) ?? null;
  }

  public async purgeScope(sessionScope: string): Promise<void> {
    if (this.shouldFail) throw new Error("database unavailable");
    this.revokedScopes.add(sessionScope);
    for (const [recordId, value] of this.records) {
      const owner = (value as Partial<ComposerRecoveryJournal>).owner;
      if (owner?.sessionScope === sessionScope) this.records.delete(recordId);
    }
  }

  public async purgeExpired(now: number, limit = 64): Promise<readonly string[]> {
    if (this.shouldFail) throw new Error("database unavailable");
    const count = Math.max(0, Math.min(64, Math.trunc(limit)));
    if (count === 0) return [];
    const expired: string[] = [];
    for (const [recordId, value] of this.records) {
      const owner = (value as Partial<ComposerRecoveryJournal>).owner;
      if ((Date.parse(owner?.sessionExpiresAt ?? "") || 0) <= now) {
        this.records.delete(recordId);
        this.revokedRecords.add(recordId);
        expired.push(recordId);
        if (expired.length >= count) break;
      }
    }
    return expired;
  }

  public async put(
    journal: ComposerRecoveryJournal,
    now = Date.now(),
  ): Promise<readonly string[]> {
    this.onPut?.();
    if (this.shouldFail) throw new Error("database unavailable");
    if (Date.parse(journal.owner.sessionExpiresAt) <= now) {
      throw new Error("record expired");
    }
    if (
      this.revokedScopes.has(journal.owner.sessionScope) ||
      this.revokedRecords.has(journal.recordId)
    ) {
      throw new Error("record revoked");
    }
    this.records.set(journal.recordId, structuredClone(journal));
    return this.trimScope(journal.owner.sessionScope);
  }

  public async remove(recordId: string): Promise<void> {
    this.onRemove?.();
    if (this.shouldFail) throw new Error("database unavailable");
    this.records.delete(recordId);
    this.revokedRecords.add(recordId);
  }

  public async trimScope(sessionScope: string): Promise<readonly string[]> {
    const records = [...this.records.entries()]
      .filter(([, value]) =>
        (value as Partial<ComposerRecoveryJournal>).owner?.sessionScope === sessionScope)
      .sort(([, left], [, right]) => Date.parse(
        (right as Partial<ComposerRecoveryJournal>).updatedAt ?? "",
      ) - Date.parse((left as Partial<ComposerRecoveryJournal>).updatedAt ?? ""));
    const removed = records.slice(4).map(([recordId]) => recordId);
    for (const recordId of removed) {
      this.records.delete(recordId);
      this.revokedRecords.add(recordId);
    }
    return removed;
  }
}

export class MemoryRecoveryPointers implements ComposerRecoverySessionStorage {
  public readonly records = new Map<string, string>();
  public shouldFail = false;
  public get length(): number { return this.records.size; }
  public getItem(key: string): string | null {
    if (this.shouldFail) throw new Error("storage unavailable");
    return this.records.get(key) ?? null;
  }
  public key(index: number): string | null {
    return [...this.records.keys()][index] ?? null;
  }
  public removeItem(key: string): void {
    if (this.shouldFail) throw new Error("storage unavailable");
    this.records.delete(key);
  }
  public setItem(key: string, value: string): void {
    if (this.shouldFail) throw new Error("storage unavailable");
    this.records.set(key, value);
  }
}
