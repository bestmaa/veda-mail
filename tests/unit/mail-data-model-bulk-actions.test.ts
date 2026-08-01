import { beforeEach, describe, expect, it } from "vitest";

import type { MailWorkspace } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import {
  api,
  inboxId,
  message,
  refresh,
  render,
  resetMailDataModelHarness,
  settle,
  workspace,
} from "./mail-data-model-session-scope.test-support";

const populated = (scope = "scope-a"): MailWorkspace => ({
  ...workspace(scope),
  messages: {
    items: [message("message-a"), message("message-b")],
    nextCursor: null,
    total: 2,
  },
});

beforeEach(resetMailDataModelHarness);

describe("mail data bulk actions", () => {
  it("projects read state before confirmation and restores only failures", async () => {
    const snapshot = populated();
    const unreadSnapshot: MailWorkspace = {
      ...snapshot,
      mailboxes: snapshot.mailboxes.map((mailbox) => ({ ...mailbox, unread: 2 })),
      messages: {
        ...snapshot.messages,
        items: snapshot.messages.items.map((item) => ({ ...item, isUnread: true })),
      },
    };
    api.getWorkspace.mockResolvedValueOnce(unreadSnapshot);
    let model = render();
    await refresh(model);
    model = render();
    model.bulk.toggle(unreadSnapshot.messages.items[0]!.id);
    model = render();
    model.bulk.toggle(unreadSnapshot.messages.items[1]!.id);
    model = render();
    const pending = Promise.withResolvers<{
      failed: readonly [typeof unreadSnapshot.messages.items[1]["id"]];
      succeeded: readonly [typeof unreadSnapshot.messages.items[0]["id"]];
    }>();
    api.mutateMessages.mockReturnValueOnce(pending.promise);

    const operation = model.bulk.mutate({ type: "set-read", value: true });
    model = render();
    expect(model.workspace?.messages.items.map(({ isUnread }) => isUnread))
      .toEqual([false, false]);
    expect(model.workspace?.mailboxes[0]?.unread).toBe(0);
    expect([...model.pendingMessageIds]).toEqual(["message-a", "message-b"]);

    pending.resolve({
      failed: [unreadSnapshot.messages.items[1]!.id],
      succeeded: [unreadSnapshot.messages.items[0]!.id],
    });
    api.getWorkspace.mockResolvedValueOnce({
      ...unreadSnapshot,
      mailboxes: unreadSnapshot.mailboxes.map((mailbox) => ({ ...mailbox, unread: 1 })),
      messages: {
        ...unreadSnapshot.messages,
        items: unreadSnapshot.messages.items.map((item, index) =>
          index === 0 ? { ...item, isUnread: false } : item),
      },
    });
    await operation;
    await settle();
    model = render();

    expect(model.workspace?.messages.items.map(({ isUnread }) => isUnread))
      .toEqual([false, true]);
    expect([...model.bulk.selectedIds]).toEqual(["message-b"]);
  });

  it("keeps only provider failures selected and refreshes successes", async () => {
    const snapshot = populated();
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    model.bulk.toggle(snapshot.messages.items[0]!.id);
    model = render();
    model.bulk.toggle(snapshot.messages.items[1]!.id);
    model = render();
    api.mutateMessages.mockResolvedValueOnce({
      failed: [snapshot.messages.items[1]!.id],
      succeeded: [snapshot.messages.items[0]!.id],
    });
    api.getWorkspace.mockResolvedValueOnce(snapshot);

    await model.bulk.mutate({ type: "set-read", value: true });
    await settle();
    model = render();

    expect(api.mutateMessages).toHaveBeenCalledWith(
      {
        messageIds: ["message-a", "message-b"],
        type: "set-read",
        value: true,
      },
      "scope-a",
    );
    expect([...model.bulk.selectedIds]).toEqual(["message-b"]);
    expect(model.bulk.status).toBe(
      "1 updated; 1 failed, was restored, and remains selected.",
    );
    expect(api.getWorkspace).toHaveBeenCalledTimes(2);
  });

  it("coalesces duplicate actions while one batch is pending", async () => {
    const snapshot = populated();
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    model.bulk.toggle(snapshot.messages.items[0]!.id);
    model = render();
    const pending = Promise.withResolvers<{
      failed: never[];
      succeeded: readonly typeof snapshot.messages.items[0]["id"][];
    }>();
    api.mutateMessages.mockReturnValueOnce(pending.promise);

    const first = model.bulk.mutate({ type: "archive" });
    const duplicate = model.bulk.mutate({ type: "archive" });

    expect(api.mutateMessages).toHaveBeenCalledOnce();
    pending.resolve({
      failed: [],
      succeeded: [snapshot.messages.items[0]!.id],
    });
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    await Promise.all([first, duplicate]);
  });

  it("preserves unrelated selection after moving an unselected row", async () => {
    const snapshot = populated();
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    model.bulk.toggle(snapshot.messages.items[0]!.id);
    model = render();
    api.mutateMessages.mockResolvedValueOnce({
      failed: [],
      succeeded: [snapshot.messages.items[1]!.id],
    });
    api.getWorkspace.mockResolvedValueOnce({
      ...snapshot,
      messages: { items: [snapshot.messages.items[0]!], nextCursor: null, total: 1 },
    });

    await model.bulk.mutateIds({
      destinationMailboxId: inboxId,
      sourceMailboxId: inboxId,
      type: "move",
    }, [snapshot.messages.items[1]!.id]);

    model = render();
    expect([...model.bulk.selectedIds]).toEqual(["message-a"]);
  });

  it("invalidates an older refresh before applying an optimistic mutation", async () => {
    const snapshot = populated();
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    model.bulk.toggle(snapshot.messages.items[0]!.id);
    model = render();
    const staleRefresh = Promise.withResolvers<MailWorkspace>();
    api.getWorkspace.mockReturnValueOnce(staleRefresh.promise);
    model.refresh();
    const mutation = Promise.withResolvers<{
      failed: readonly [];
      succeeded: readonly [typeof snapshot.messages.items[0]["id"]];
    }>();
    api.mutateMessages.mockReturnValueOnce(mutation.promise);

    const operation = model.bulk.mutate({ type: "set-starred", value: true });
    staleRefresh.resolve(snapshot);
    await settle();
    model = render();
    expect(model.workspace?.messages.items[0]?.isStarred).toBe(true);

    mutation.resolve({ failed: [], succeeded: [snapshot.messages.items[0]!.id] });
    api.getWorkspace.mockResolvedValueOnce({
      ...snapshot,
      messages: {
        ...snapshot.messages,
        items: snapshot.messages.items.map((item, index) =>
          index === 0 ? { ...item, isStarred: true } : item),
      },
    });
    await operation;
  });

  it("retains the selection and exposes a retryable request error", async () => {
    const snapshot = populated();
    api.getWorkspace.mockResolvedValueOnce(snapshot);
    let model = render();
    await refresh(model);
    model = render();
    model.bulk.toggle(snapshot.messages.items[0]!.id);
    model = render();
    api.mutateMessages.mockRejectedValueOnce(new Error("Provider timed out."));
    api.getWorkspace.mockResolvedValueOnce(snapshot);

    await model.bulk.mutate({ type: "delete" });
    model = render();

    expect([...model.bulk.selectedIds]).toEqual(["message-a"]);
    expect(model.bulk.error).toBe(
      "The update could not be confirmed. Messages are being refreshed before retry.",
    );
    expect(api.getWorkspace).toHaveBeenCalledTimes(2);
  });

  it("rejects operations beyond the bounded client budget", async () => {
    api.getWorkspace.mockResolvedValueOnce(populated());
    let model = render();
    await refresh(model);
    model = render();

    await model.bulk.mutateIds(
      { type: "archive" },
      Array.from({ length: 2_001 }, (_, index) => id.message(`message-${index}`)),
    );
    model = render();

    expect(api.mutateMessages).not.toHaveBeenCalled();
    expect(model.bulk.error).toBe("Update at most 2000 messages at a time.");
  });
});
