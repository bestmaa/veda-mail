import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AttachmentScanner } from "@/server/attachments";
import {
  attachmentScope,
  body,
  quarantineFixture,
  reserveText,
} from "./attachment-quarantine.fixture";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-attachment-quota-"));
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

describe("attachment quarantine quotas", () => {
  it("enforces file, count, draft aggregate, and session quotas", async () => {
    const quarantine = quarantineFixture(directory, {
      quotas: {
        maxAggregateBytesPerDraft: 6,
        maxBytesPerSession: 8,
        maxFileBytes: 4,
        maxFilesPerDraft: 2,
      },
    });
    await reserveText(quarantine, 4);
    await expect(reserveText(quarantine, 3)).rejects.toMatchObject({
      code: "ATTACHMENT_DRAFT_QUOTA_EXCEEDED",
    });
    await reserveText(quarantine, 2);
    await expect(reserveText(quarantine, 1)).rejects.toMatchObject({
      code: "ATTACHMENT_COUNT_QUOTA_EXCEEDED",
    });
    await expect(reserveText(quarantine, 5)).rejects.toMatchObject({
      code: "ATTACHMENT_FILE_QUOTA_EXCEEDED",
    });
    const secondDraft = { ...attachmentScope, draftId: "another-draft" };
    await reserveText(quarantine, 2, secondDraft);
    await expect(reserveText(quarantine, 1, secondDraft)).rejects.toMatchObject(
      {
        code: "ATTACHMENT_SESSION_QUOTA_EXCEEDED",
      },
    );
  });

  it("releases rejected reservations from quota accounting", async () => {
    const infected: AttachmentScanner = {
      async scan(content) {
        for await (const _chunk of content) {
          void _chunk;
        }
        return { verdict: "infected" };
      },
    };
    const quarantine = quarantineFixture(directory, {
      quotas: { maxFilesPerDraft: 1 },
      scanner: infected,
    });
    const first = await reserveText(quarantine, 1);
    await expect(
      quarantine.upload(first.id, attachmentScope, body("x"), 1),
    ).rejects.toMatchObject({ code: "ATTACHMENT_REJECTED" });
    await expect(reserveText(quarantine, 1)).resolves.toMatchObject({
      state: "reserved",
    });
  });

  it("enforces a byte ceiling across independent sessions", async () => {
    const quarantine = quarantineFixture(directory, {
      quotas: {
        maxAggregateBytesPerDraft: 4,
        maxBytesPerSession: 4,
        maxFileBytes: 4,
        maxGlobalBytes: 6,
      },
    });
    await reserveText(quarantine, 4);
    const secondSession = {
      connectionId: "connection-2",
      draftId: "draft-2",
      ownerId: "owner-2@example.com",
      sessionId: "session-2",
    };
    await reserveText(quarantine, 2, secondSession);

    await expect(
      reserveText(quarantine, 1, {
        ...secondSession,
        draftId: "draft-3",
      }),
    ).rejects.toMatchObject({ code: "ATTACHMENT_GLOBAL_QUOTA_EXCEEDED" });
  });

  it("enforces a record ceiling across independent sessions", async () => {
    const quarantine = quarantineFixture(directory, {
      quotas: { maxFilesPerDraft: 2, maxGlobalRecords: 2 },
    });
    await reserveText(quarantine, 1);
    await reserveText(quarantine, 1, {
      connectionId: "connection-2",
      draftId: "draft-2",
      ownerId: "owner-2@example.com",
      sessionId: "session-2",
    });

    await expect(
      reserveText(quarantine, 1, {
        connectionId: "connection-3",
        draftId: "draft-3",
        ownerId: "owner-3@example.com",
        sessionId: "session-3",
      }),
    ).rejects.toMatchObject({ code: "ATTACHMENT_GLOBAL_QUOTA_EXCEEDED" });
  });

  it("counts rejected records until explicit removal or expiry", async () => {
    const quarantine = quarantineFixture(directory, {
      quotas: { maxFilesPerDraft: 1, maxGlobalRecords: 1 },
    });
    const reserved = await reserveText(quarantine, 1);
    await expect(
      quarantine.upload(reserved.id, attachmentScope, body("too long"), 1),
    ).rejects.toMatchObject({ code: "ATTACHMENT_LENGTH_MISMATCH" });
    await expect(reserveText(quarantine, 1)).rejects.toMatchObject({
      code: "ATTACHMENT_GLOBAL_QUOTA_EXCEEDED",
    });

    await quarantine.remove(reserved.id, attachmentScope);
    await expect(reserveText(quarantine, 1)).resolves.toBeDefined();
  });

  it("frees the hard record ceiling after successful consumption", async () => {
    const quarantine = quarantineFixture(directory, {
      quotas: { maxFilesPerDraft: 1, maxGlobalRecords: 1 },
    });
    const reserved = await reserveText(quarantine, 1);
    await quarantine.upload(reserved.id, attachmentScope, body("x"), 1);
    await quarantine.claim([reserved.id], attachmentScope);
    await quarantine.consume([reserved.id], attachmentScope);

    await expect(reserveText(quarantine, 1)).resolves.toBeDefined();
  });
});
