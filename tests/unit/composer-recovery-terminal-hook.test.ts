import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { canonicalComposerRecoveryJournal } from "@/presentation/features/mail-workspace/composer-recovery-schema";
import type { ComposerRecoveryJournal } from "@/presentation/features/mail-workspace/composer-recovery.types";
import { recoveryJournal, recoverySnapshot } from "./composer-recovery-fixture";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback,
}));

import { useComposerRecoveryTerminal } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-terminal";

const providerDraftId = id.providerDraft("provider-terminal-hook-a");
const checkpoint = {
  composeId: recoveryJournal().composeId,
  generation: 0,
  snapshot: recoverySnapshot(),
};
const baseTemplate = (): ComposerRecoveryJournal => {
  const { acknowledged, pendingSave, terminalIntent, ...base } = recoveryJournal();
  void acknowledged; void pendingSave; void terminalIntent;
  return canonicalComposerRecoveryJournal({
    ...base, localGeneration: 0, storageRevision: 1,
  });
};

const setup = (afterPersist?: (
  activeRef: { current: ComposerRecoveryJournal | null },
  journal: ComposerRecoveryJournal,
) => void) => {
  const activeRef = { current: null as ComposerRecoveryJournal | null };
  const writes: ComposerRecoveryJournal[] = [];
  const clearActive = vi.fn(async () => { activeRef.current = null; });
  const persist = vi.fn(async (journal: ComposerRecoveryJournal) => {
    writes.push(journal);
    activeRef.current = journal;
    afterPersist?.(activeRef, journal);
    return true;
  });
  const nextJournal = vi.fn((value: typeof checkpoint) => {
    const current = activeRef.current;
    return canonicalComposerRecoveryJournal({
      ...(current ?? baseTemplate()),
      composeId: value.composeId,
      localGeneration: value.generation,
      snapshot: value.snapshot,
      storageRevision: current ? current.storageRevision + 1 : 1,
      updatedAt: new Date().toISOString(),
    });
  });
  const terminal = useComposerRecoveryTerminal({
    activeRef, clearActive, nextJournal, persist,
  });
  return { activeRef, clearActive, terminal, writes };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-31T12:10:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("composer recovery terminal hook", () => {
  it("arms from a newer concurrent checkpoint instead of a stale revision", async () => {
    let advanced = false;
    const harness = setup((activeRef, journal) => {
      if (advanced || journal.terminalIntent) return;
      advanced = true;
      activeRef.current = canonicalComposerRecoveryJournal({
        ...journal,
        snapshot: recoverySnapshot("Normalized body with the same generation"),
        storageRevision: journal.storageRevision + 1,
      });
    });
    const prepared = await harness.terminal.prepareSend({
      attachmentIds: [], bcc: [], body: "  Body  ", cc: [],
      draftId: checkpoint.composeId, subject: "Subject",
      to: [{ email: "person@example.com", name: null }],
    }, checkpoint);

    expect(prepared).not.toBeNull();
    expect(prepared?.request.body).toBe("Body");
    expect(harness.activeRef.current?.terminalIntent?.kind).toBe("send");
    expect(harness.activeRef.current?.terminalIntent).not.toHaveProperty("request");
    expect(harness.activeRef.current?.terminalIntent).toMatchObject({
      requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(harness.activeRef.current?.storageRevision).toBe(3);
  });

  it("creates an acknowledgement before arming a freshly loaded saved draft", async () => {
    const harness = setup();
    const prepared = await harness.terminal.prepareSend({
      attachmentIds: [], bcc: [], body: "Body", cc: [],
      draftId: checkpoint.composeId, expectedDraftRevision: "revision-a",
      providerDraftId, subject: "Subject",
      to: [{ email: "person@example.com", name: null }],
    }, checkpoint);

    expect(prepared?.request.providerDraftId).toBe(providerDraftId);
    expect(harness.writes).toHaveLength(2);
    expect(harness.writes[0]?.acknowledged).toEqual({
      generation: 0, providerDraftId, revision: "revision-a",
    });
    expect(harness.writes[1]?.terminalIntent?.kind).toBe("send");
  });

  it("does not release the in-memory request when the durable digest differs", async () => {
    const harness = setup((activeRef, journal) => {
      if (journal.terminalIntent?.kind !== "send") return;
      activeRef.current = canonicalComposerRecoveryJournal({
        ...journal,
        storageRevision: journal.storageRevision + 1,
        terminalIntent: {
          ...journal.terminalIntent,
          requestFingerprint: "b".repeat(64),
        },
      });
    });

    await expect(harness.terminal.prepareSend({
      attachmentIds: [], bcc: [], body: "Body", cc: [],
      draftId: checkpoint.composeId, subject: "Subject",
      to: [{ email: "person@example.com", name: null }],
    }, checkpoint)).resolves.toBeNull();
  });

  it("clears only the matching active terminal intent", async () => {
    const harness = setup();
    const prepared = await harness.terminal.prepareSend({
      attachmentIds: [], bcc: [], body: "Body", cc: [],
      draftId: checkpoint.composeId, subject: "Subject",
      to: [{ email: "person@example.com", name: null }],
    }, checkpoint);
    expect(await harness.terminal.completeTerminal("wrong-intent")).toBe(false);
    expect(harness.clearActive).not.toHaveBeenCalled();
    expect(await harness.terminal.completeTerminal(prepared!.intentId)).toBe(true);
    expect(harness.clearActive).toHaveBeenCalledOnce();
  });

  it("keeps terminal evidence on close but clears an ordinary recovery copy", async () => {
    const harness = setup();
    harness.activeRef.current = baseTemplate();
    await harness.terminal.clearForClose();
    expect(harness.clearActive).toHaveBeenCalledOnce();

    const second = setup();
    await second.terminal.prepareSend({
      attachmentIds: [], bcc: [], body: "Body", cc: [],
      draftId: checkpoint.composeId, subject: "Subject",
      to: [{ email: "person@example.com", name: null }],
    }, checkpoint);
    await second.terminal.clearForClose();
    expect(second.clearActive).not.toHaveBeenCalled();
  });

  it("atomically keeps the snapshot while resuming an uncertain send copy", async () => {
    const harness = setup();
    const prepared = await harness.terminal.prepareSend({
      attachmentIds: [], bcc: [], body: "Body", cc: [],
      draftId: checkpoint.composeId, subject: "Subject",
      to: [{ email: "person@example.com", name: null }],
    }, checkpoint);
    await harness.terminal.markSendUncertain(prepared!.intentId);

    expect(await harness.terminal.resumeTerminal()).toBe(true);
    expect(harness.activeRef.current?.terminalIntent).toBeUndefined();
    expect(harness.activeRef.current?.snapshot).toEqual(checkpoint.snapshot);
    expect(harness.clearActive).not.toHaveBeenCalled();
  });
});
