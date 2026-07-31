import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  canonicalComposerRecoveryJournal,
  MAX_COMPOSER_RECOVERY_BYTES,
  parseComposerRecoveryJournal,
} from "@/presentation/features/mail-workspace/composer-recovery-schema";
import { createComposerRecoveryStorage } from "@/presentation/features/mail-workspace/composer-recovery-storage";
import {
  MemoryRecoveryDatabase,
  MemoryRecoveryPointers,
  recoveryJournal,
  recoveryOwner,
  recoverySnapshot,
} from "./composer-recovery-fixture";

const now = Date.parse("2026-07-31T12:30:00.000Z");
const pointerKey = (recordId: string) =>
  `veda-mail:composer-recovery:v1:${recordId}`;
const setup = () => {
  const database = new MemoryRecoveryDatabase();
  const pointers = new MemoryRecoveryPointers();
  return {
    database,
    pointers,
    storage: createComposerRecoveryStorage({ database, pointers }),
  };
};

describe("composer recovery journal", () => {
  it("round-trips raw partial recipients through an exact owner-bound record", async () => {
    const { storage } = setup();
    const journal = recoveryJournal();
    await expect(storage.write(journal, now)).resolves.toBe("stored");

    await expect(storage.list(recoveryOwner, now)).resolves.toEqual([
      canonicalComposerRecoveryJournal(journal),
    ]);
  });

  it("keeps only an opaque pointer in sessionStorage", async () => {
    const { pointers, storage } = setup();
    await storage.write(recoveryJournal(), now);
    const serialized = [...pointers.records.values()].join("");

    expect(serialized).toContain("22222222-2222-4222-8222-222222222222");
    expect(serialized).toContain("scope-a");
    expect(serialized).not.toMatch(/subject|recipient|body|bcc|composeId/iu);
  });

  it("discovers a durable journal after tab-scoped pointers disappear", async () => {
    const { database, storage } = setup();
    const journal = recoveryJournal();
    await storage.write(journal, now);
    const nextTabPointers = new MemoryRecoveryPointers();
    const nextTabStorage = createComposerRecoveryStorage({
      database,
      pointers: nextTabPointers,
    });

    await expect(nextTabStorage.list(recoveryOwner, now)).resolves.toEqual([
      canonicalComposerRecoveryJournal(journal),
    ]);
    expect(nextTabPointers.records.has(pointerKey(journal.recordId))).toBe(true);
  });

  it("purges expired durable journals even when no pointer survives", async () => {
    const { database, storage } = setup();
    const journal = recoveryJournal();
    await storage.write(journal, now);
    const nextTabStorage = createComposerRecoveryStorage({
      database,
      pointers: new MemoryRecoveryPointers(),
    });

    await expect(nextTabStorage.list(
      recoveryOwner,
      Date.parse(recoveryOwner.sessionExpiresAt),
    )).resolves.toEqual([]);
    expect(database.records.has(journal.recordId)).toBe(false);
    expect(database.revokedRecords.has(journal.recordId)).toBe(true);
  });

  it("finds recovery pointers after more than 32 unrelated storage keys", async () => {
    const { database, pointers, storage } = setup();
    database.discoverScope = async () => [];
    for (let index = 0; index < 40; index += 1) {
      pointers.setItem(`unrelated:${index}`, "opaque");
    }
    const journal = recoveryJournal();
    await storage.write(journal, now);

    await expect(storage.list(recoveryOwner, now)).resolves.toEqual([
      canonicalComposerRecoveryJournal(journal),
    ]);
  });

  it("sorts all candidates before retaining the newest four", async () => {
    const { database, storage } = setup();
    const recordIds = [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000003",
      "10000000-0000-4000-8000-000000000004",
      "10000000-0000-4000-8000-000000000005",
    ];
    const journals = recordIds.map((recordId, index) => {
      const composeId = id.draft(recordId);
      return recoveryJournal({
        composeId,
        pendingSave: { ...recoveryJournal().pendingSave!, composeId },
        recordId,
        updatedAt: `2026-07-31T12:0${index}:00.000Z`,
      });
    });
    for (const journal of journals) await storage.write(journal, now);

    await expect(storage.list(recoveryOwner, now)).resolves.toEqual(
      journals.slice(1).reverse().map(canonicalComposerRecoveryJournal),
    );
    expect(database.records.has(recordIds[0]!)).toBe(false);
  });

  it("never leaves hidden recovery records after forty distinct writes", async () => {
    const { database, storage } = setup();
    for (let index = 0; index < 40; index += 1) {
      const suffix = index.toString().padStart(12, "0");
      const recordId = `10000000-0000-4000-8000-${suffix}`;
      const composeId = id.draft(recordId);
      await storage.write(recoveryJournal({
        composeId,
        pendingSave: { ...recoveryJournal().pendingSave!, composeId },
        recordId,
        updatedAt: new Date(now + index).toISOString(),
      }), now);
    }

    const visible = await storage.list(recoveryOwner, now);
    expect(visible).toHaveLength(4);
    expect(database.records.size).toBe(4);
    for (const journal of visible) await storage.remove(journal.recordId);
    await expect(storage.list(recoveryOwner, now)).resolves.toEqual([]);
  });

  it("writes the pointer before the durable record and clears it before delete", async () => {
    const { database, pointers, storage } = setup();
    database.onPut = () => expect(pointers.length).toBe(1);
    await storage.write(recoveryJournal(), now);
    database.onRemove = () => expect(pointers.length).toBe(0);

    await storage.remove(recoveryJournal().recordId);
    expect(database.records.size).toBe(0);
  });

  it("fails closed for unavailable storage without exposing a false checkpoint", async () => {
    const { database, pointers, storage } = setup();
    pointers.shouldFail = true;
    await expect(storage.write(recoveryJournal(), now)).resolves.toBe("unavailable");
    expect(database.records.size).toBe(0);

    pointers.shouldFail = false;
    database.shouldFail = true;
    await expect(storage.write(recoveryJournal(), now)).resolves.toBe("unavailable");
    expect([...pointers.records.values()].join("")).not.toContain("Latest local body");
    database.shouldFail = false;
    await expect(storage.list(recoveryOwner, now)).resolves.toEqual([]);
    expect(pointers.length).toBe(0);
  });

  it("purges wrong-scope, expired, malformed, and mismatched records", async () => {
    const { database, pointers, storage } = setup();
    await storage.write(recoveryJournal(), now);
    await expect(storage.list({ ...recoveryOwner, sessionScope: "scope-b" }, now))
      .resolves.toEqual([]);
    expect([database.records.size, pointers.length]).toEqual([0, 0]);

    await storage.write(recoveryJournal(), now);
    await expect(storage.list(recoveryOwner, Date.parse("2026-08-01T00:00:00.000Z")))
      .resolves.toEqual([]);
    await storage.write(recoveryJournal(), now);
    database.records.set(recoveryJournal().recordId, { hostile: true });
    await expect(storage.list(recoveryOwner, now)).resolves.toEqual([]);
  });

  it("rejects impossible generations, owner drift, and unsafe rich HTML", () => {
    expect(parseComposerRecoveryJournal(recoveryJournal({ localGeneration: 0 })))
      .toBeNull();
    expect(parseComposerRecoveryJournal(recoveryJournal({
      owner: { ...recoveryOwner, sessionExpiresAt: "2026-07-31T11:00:00.000Z" },
    }))).toBeNull();
    expect(parseComposerRecoveryJournal(recoveryJournal({
      snapshot: {
        ...recoverySnapshot(),
        body: {
          html: "<script>alert(1)</script><p>Safe</p>",
          mode: "rich",
          preserveLoadedHtml: true,
          text: "Safe",
        },
      },
    }))).toBeNull();
  });

  it("requires an exact acknowledgement for a pending update", () => {
    const providerDraftId = id.providerDraft("provider-draft-a");
    const pendingSave = {
      composeId: recoveryJournal().composeId,
      content: recoveryJournal().pendingSave!.content,
      contentGeneration: 2,
      expectedRevision: "revision-a",
      providerDraftId,
    };
    expect(parseComposerRecoveryJournal(recoveryJournal({ pendingSave }))).toBeNull();
    expect(parseComposerRecoveryJournal(recoveryJournal({
      acknowledged: { generation: 1, providerDraftId, revision: "revision-a" },
      pendingSave,
    }))).not.toBeNull();
    expect(parseComposerRecoveryJournal(recoveryJournal({
      acknowledged: { generation: 2, providerDraftId, revision: "revision-a" },
      pendingSave: { ...pendingSave, contentGeneration: 1 },
    }))).toBeNull();
  });

  it("accepts two maximum content generations and rejects values over the cap", () => {
    const text = "a".repeat(255_000);
    const html = `<p>${"b".repeat(255_000)}</p>`;
    const journal = recoveryJournal({
      pendingSave: {
        composeId: recoveryJournal().composeId,
        content: {
          bcc: [], body: "c".repeat(256_000), cc: [],
          htmlBody: `<p>${"d".repeat(255_000)}</p>`, subject: "", to: [],
        },
        contentGeneration: 1,
      },
      snapshot: {
        ...recoverySnapshot(),
        body: { html, mode: "rich", preserveLoadedHtml: true, text },
      },
    });
    expect(canonicalComposerRecoveryJournal(journal).snapshot.body.mode)
      .toBe("rich");
    expect(parseComposerRecoveryJournal({
      ...journal,
      oversized: "x".repeat(MAX_COMPOSER_RECOVERY_BYTES + 1),
    })).toBeNull();
  });
});
