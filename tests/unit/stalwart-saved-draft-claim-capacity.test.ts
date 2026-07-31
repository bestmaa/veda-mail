import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import type { StalwartDraftSendSource } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.store";
import { claimStalwartSavedDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-claim-acquire";

describe("Stalwart saved draft claim capacity", () => {
  it("does not mutate a draft without claim-keyword headroom", async () => {
    const request = vi.fn();
    const client = { request } as unknown as StalwartJmapClient;
    const keywords = Object.fromEntries(
      Array.from({ length: 1_024 }, (_, index) => [
        `user-keyword-${index}`,
        true,
      ]),
    );
    const source = {
      context: { accountId: "account", draftsMailboxId: "drafts" },
      record: {
        detail: { id: id.providerDraft("draft") },
        email: { keywords } as JmapDraftEmail,
        state: "state-1",
      },
    } as StalwartDraftSendSource;
    await expect(
      claimStalwartSavedDraft(client, source, {
        accountId: "account",
        draftMailboxId: "drafts",
        identity: { email: "member@example.com", id: "identity" },
        sentMailboxId: "sent",
      }),
    ).rejects.toThrow("changed since it was last loaded");
    expect(request).not.toHaveBeenCalled();
  });

  it("reloads instead of synthesizing a server-computed claim update", async () => {
    const request = vi.fn(async () => ({
      methodResponses: [],
      sessionState: "session",
    }));
    const result = vi.fn((_response: unknown, callId: string) =>
      callId === "claim-saved-draft"
        ? {
            accountId: "account",
            newState: "state-2",
            oldState: "state-1",
            updated: { draft: { mailboxIds: { drafts: null } } },
          }
        : {
            accountId: "account",
            list: [],
            notFound: ["draft"],
            state: "state-2",
          },
    );
    const client = { request, result } as unknown as StalwartJmapClient;
    const source = {
      context: { accountId: "account", draftsMailboxId: "drafts" },
      record: {
        detail: { id: id.providerDraft("draft") },
        email: { keywords: { $draft: true } } as unknown as JmapDraftEmail,
        state: "state-1",
      },
    } as StalwartDraftSendSource;
    await expect(
      claimStalwartSavedDraft(client, source, {
        accountId: "account",
        draftMailboxId: "drafts",
        identity: { email: "member@example.com", id: "identity" },
        sentMailboxId: "sent",
      }),
    ).resolves.toEqual({ kind: "uncertain" });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
