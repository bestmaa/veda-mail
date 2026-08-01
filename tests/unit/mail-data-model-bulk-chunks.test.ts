import { beforeEach, describe, expect, it } from "vitest";

import type { MailWorkspace } from "@/domain/mail/mail";
import { id, type MessageId } from "@/domain/shared/brand";
import {
  api,
  message,
  refresh,
  render,
  resetMailDataModelHarness,
  settle,
  workspace,
} from "./mail-data-model-session-scope.test-support";

beforeEach(resetMailDataModelHarness);

describe("multi-chunk bulk message actions", () => {
  it("stops after the current batch and rolls back unsent messages", async () => {
    const messageIds = Array.from(
      { length: 101 },
      (_, index) => id.message(`stop-message-${index}`),
    );
    const snapshot: MailWorkspace = {
      ...workspace("scope-a"),
      messages: {
        items: messageIds.map((messageId) => message(messageId)),
        nextCursor: null,
        total: messageIds.length,
      },
    };
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    const currentBatch = Promise.withResolvers<{
      failed: readonly MessageId[];
      succeeded: readonly MessageId[];
    }>();
    api.mutateMessages.mockReturnValueOnce(currentBatch.promise);
    const reconciliation = Promise.withResolvers<MailWorkspace>();
    api.getWorkspace.mockReturnValueOnce(reconciliation.promise);

    const operation = model.bulk.mutateIds(
      { type: "set-starred", value: true }, messageIds,
    );
    model = render();
    expect(model.bulk.canStop).toBe(true);
    model.bulk.stop();
    model = render();
    expect(model.bulk.canStop).toBe(false);
    expect(model.bulk.isBusy).toBe(true);

    currentBatch.resolve({ failed: [], succeeded: messageIds.slice(0, 100) });
    await operation;
    model = render();

    expect(api.mutateMessages).toHaveBeenCalledOnce();
    expect(model.workspace?.messages.items[0]?.isStarred).toBe(true);
    expect(model.workspace?.messages.items[100]?.isStarred).toBe(false);
    expect([...model.bulk.selectedIds]).toEqual([messageIds[100]]);
    expect(model.bulk.status).toBe(
      "100 updated; 1 stopped before sending and remains selected.",
    );
    expect(model.bulk.isBusy).toBe(false);

    reconciliation.resolve(snapshot);
    await settle();
  });

  it("preserves definite failures when a later chunk is unconfirmed", async () => {
    const messageIds = Array.from(
      { length: 101 },
      (_, index) => id.message(`message-${index}`),
    );
    const snapshot: MailWorkspace = {
      ...workspace("scope-a"),
      messages: {
        items: messageIds.map((messageId) => message(messageId)),
        nextCursor: null,
        total: messageIds.length,
      },
    };
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    const failedId = messageIds[1]!;
    const unresolvedId = messageIds[100]!;
    api.mutateMessages.mockResolvedValueOnce({
      failed: [failedId],
      succeeded: messageIds.slice(0, 100).filter((messageId) =>
        messageId !== failedId),
    });
    api.mutateMessages.mockRejectedValueOnce(new Error("Provider timed out."));
    const reconciliation = Promise.withResolvers<MailWorkspace>();
    api.getWorkspace.mockReturnValueOnce(reconciliation.promise);

    await model.bulk.mutateIds(
      { type: "set-starred", value: true },
      messageIds,
    );
    model = render();

    expect([...model.bulk.selectedIds]).toEqual([failedId, unresolvedId]);
    expect([...model.pendingMessageIds]).toEqual([unresolvedId]);
    expect(model.workspace?.messages.items[0]?.isStarred).toBe(true);
    expect(model.workspace?.messages.items[1]?.isStarred).toBe(false);
    expect(model.workspace?.messages.items[100]?.isStarred).toBe(true);
    expect(model.bulk.status).toBe(
      "99 updated; 1 failed, was restored, and remains selected; " +
      "1 could not be confirmed and remains selected.",
    );

    reconciliation.resolve(snapshot);
    await settle();
    model = render();
    expect([...model.pendingMessageIds]).toEqual([]);
  });
});
