import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { fingerprintComposerRecoverySend } from "@/presentation/features/mail-workspace/composer-recovery-send-fingerprint";
import { createComposerRecoveryStorage } from "@/presentation/features/mail-workspace/composer-recovery-storage";
import { armComposerRecoverySend } from "@/presentation/features/mail-workspace/composer-recovery-transitions";
import {
  MemoryRecoveryDatabase,
  MemoryRecoveryPointers,
  recoveryJournal,
  recoveryOwner,
} from "./composer-recovery-fixture";

const now = Date.parse("2026-07-31T12:30:00.000Z");
const pointerKey = (recordId: string) =>
  `veda-mail:composer-recovery:v1:${recordId}`;

describe("composer recovery storage security", () => {
  it("purges a malformed durable record and its opaque pointer", async () => {
    const database = new MemoryRecoveryDatabase();
    const pointers = new MemoryRecoveryPointers();
    const storage = createComposerRecoveryStorage({ database, pointers });
    const recordId = recoveryJournal().recordId;
    pointers.setItem(pointerKey(recordId), JSON.stringify({
      recordId,
      sessionScope: recoveryOwner.sessionScope,
      version: 1,
    }));
    database.records.set(recordId, { hostile: true });

    await expect(storage.list(recoveryOwner, now)).resolves.toEqual([]);
    expect(database.records.has(recordId)).toBe(false);
    expect(pointers.length).toBe(0);
  });

  it("deletes invalid pointer values without reading attacker-selected records", async () => {
    const database = new MemoryRecoveryDatabase();
    const pointers = new MemoryRecoveryPointers();
    const storage = createComposerRecoveryStorage({ database, pointers });
    pointers.setItem(pointerKey(recoveryJournal().recordId), JSON.stringify({
      composeId: "secret-compose-id",
      recordId: recoveryJournal().recordId,
      sessionScope: recoveryOwner.sessionScope,
      version: 1,
    }));

    await expect(storage.list(recoveryOwner, now)).resolves.toEqual([]);
    expect(pointers.length).toBe(0);
    expect(database.records.size).toBe(0);
  });

  it("purges only the requested scope pointers before durable revocation", async () => {
    const database = new MemoryRecoveryDatabase();
    const pointers = new MemoryRecoveryPointers();
    const storage = createComposerRecoveryStorage({ database, pointers });
    const first = recoveryJournal();
    const second = recoveryJournal({
      owner: { ...recoveryOwner, sessionScope: "scope-b" },
      recordId: "33333333-3333-4333-8333-333333333333",
    });
    await storage.write(first, now);
    await storage.write(second, now);

    await storage.purgeScope(recoveryOwner.sessionScope);
    expect(database.revokedScopes).toEqual(new Set([recoveryOwner.sessionScope]));
    expect(pointers.records.has(pointerKey(first.recordId))).toBe(false);
    expect(pointers.records.has(pointerKey(second.recordId))).toBe(true);
  });

  it("never serializes send content or upload capabilities in a terminal marker", async () => {
    const database = new MemoryRecoveryDatabase();
    const pointers = new MemoryRecoveryPointers();
    const storage = createComposerRecoveryStorage({ database, pointers });
    const attachmentId = "terminal-upload-capability-1234567890";
    const body = "terminal-only confidential body";
    const recipient = "terminal-only@example.com";
    const fingerprinted = await fingerprintComposerRecoverySend({
      attachmentIds: [id.attachmentUpload(attachmentId)],
      bcc: [],
      body,
      cc: [],
      draftId: recoveryJournal().composeId,
      subject: "Terminal-only subject",
      to: [{ email: recipient, name: null }],
    });
    const { pendingSave, ...base } = recoveryJournal();
    void pendingSave;
    const armed = armComposerRecoverySend(base, {
      intentId: "77777777-7777-4777-8777-777777777777",
      issuedAt: "2026-07-31T12:05:00.000Z",
      requestFingerprint: fingerprinted.requestFingerprint,
    });
    expect(armed).not.toBeNull();
    if (!armed) throw new Error("Expected a fingerprinted terminal marker.");

    await storage.write(armed, now);

    const serialized = JSON.stringify(database.records.get(base.recordId));
    expect(serialized).toContain(fingerprinted.requestFingerprint);
    expect(serialized).not.toContain(attachmentId);
    expect(serialized).not.toContain(body);
    expect(serialized).not.toContain(recipient);
    expect(serialized).not.toContain('"request"');
  });
});
