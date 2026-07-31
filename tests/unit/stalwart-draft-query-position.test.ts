import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { assertStalwartDraftComposeMembers } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-compose-members";
import {
  findStalwartDraftByKeyword,
  loadStalwartDraftRecord,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader";
import { StalwartDraftReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.reader";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";

const composeId = id.draft("bd2d3f16-8408-4489-8678-b94a66cd7736");
const context = { accountId: "account", draftsMailboxId: "drafts" };

const clientForNonzeroPosition = (): StalwartJmapClient =>
  ({
    request: vi.fn(async () => ({
      methodResponses: [],
      sessionState: "session",
    })),
    result: vi.fn(() => ({
      accountId: "account",
      ids: ["draft"],
      position: 1,
      queryState: "query-state",
      total: 1,
    })),
  }) as unknown as StalwartJmapClient;

describe("Stalwart exact draft queries", () => {
  it("rejects a nonzero compose-query position", async () => {
    const client = clientForNonzeroPosition();
    const reader = new StalwartDraftReader(client, {} as StalwartMailReader);
    await expect(reader.findByComposeId(context, composeId)).rejects.toThrow(
      "changed since it was last loaded",
    );
  });

  it("rejects a nonzero operation-query position", async () => {
    await expect(
      findStalwartDraftByKeyword(
        clientForNonzeroPosition(),
        context,
        "veda-create-v1-marker",
      ),
    ).rejects.toThrow("changed since it was last loaded");
  });

  it("rejects a nonzero compose-members position", async () => {
    await expect(
      assertStalwartDraftComposeMembers(
        clientForNonzeroPosition(),
        context,
        composeId,
        [id.providerDraft("draft")],
      ),
    ).rejects.toThrow("changed since it was last loaded");
  });

  it("rejects a contradictory get partition", async () => {
    const client = {
      request: vi.fn(async () => ({
        methodResponses: [],
        sessionState: "session",
      })),
      result: vi.fn(() => ({
        accountId: "account",
        list: [{ id: "draft" }],
        notFound: ["draft"],
        state: "state-1",
      })),
    } as unknown as StalwartJmapClient;
    await expect(
      loadStalwartDraftRecord(client, context, id.providerDraft("draft")),
    ).rejects.toThrow("changed since it was last loaded");
  });

  it("requires an empty notFound partition for a state-only read", async () => {
    const client = {
      request: vi.fn(async () => ({
        methodResponses: [],
        sessionState: "session",
      })),
      result: vi.fn(() => ({
        accountId: "account",
        list: [],
        notFound: ["unexpected"],
        state: "state-1",
      })),
    } as unknown as StalwartJmapClient;
    const reader = new StalwartDraftReader(client, {} as StalwartMailReader);
    await expect(reader.state(context)).rejects.toThrow(
      "changed since it was last loaded",
    );
  });
});
