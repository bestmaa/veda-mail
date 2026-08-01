import { describe, expect, it } from "vitest";

import type { MailWorkspace, MessageDetail } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { OptimisticMessageState } from "@/presentation/features/mail-workspace/optimistic-message-state";
import {
  inboxId,
  message,
  workspace,
} from "./mail-data-model-session-scope.test-support";

const populated = (): MailWorkspace => ({
  ...workspace("scope-a"),
  mailboxes: workspace("scope-a").mailboxes.map((mailbox) => ({
    ...mailbox,
    total: 2,
    unread: 2,
  })),
  messages: {
    items: [
      { ...message("message-a"), isUnread: true },
      { ...message("message-b"), isUnread: true },
    ],
    nextCursor: null,
    total: 2,
  },
});

const populatedWithDestinations = (): MailWorkspace => {
  const base = populated();
  const mailbox = base.mailboxes[0]!;
  return {
    ...base,
    mailboxes: [
      mailbox,
      { ...mailbox, id: id.mailbox("archive"), name: "Archive", role: "archive", total: 4, unread: 1 },
      { ...mailbox, id: id.mailbox("trash"), name: "Trash", role: "trash", total: 3, unread: 0 },
      { ...mailbox, id: id.mailbox("custom"), name: "Projects", role: "custom", total: 5, unread: 2 },
    ],
  };
};

const begin = (state: OptimisticMessageState, mutation: Parameters<OptimisticMessageState["begin"]>[0]["mutation"]) =>
  state.begin({ activeMailboxId: inboxId, mutation, sessionScope: "scope-a", viewKey: "inbox" });

describe("optimistic message transaction state", () => {
  it("projects immediately and rolls back only confirmed failures", () => {
    const state = new OptimisticMessageState();
    state.acceptWorkspace(populated(), "inbox");
    const token = begin(state, {
      messageIds: [id.message("message-a"), id.message("message-b")],
      type: "set-read",
      value: true,
    });

    expect(token).not.toBeNull();
    expect(state.snapshot().workspace?.messages.items.map(({ isUnread }) => isUnread))
      .toEqual([false, false]);
    expect(state.snapshot().workspace?.mailboxes[0]?.unread).toBe(0);
    state.settle(token!, [id.message("message-a")]);

    expect(state.snapshot().workspace?.messages.items.map(({ isUnread }) => isUnread))
      .toEqual([false, true]);
    expect(state.snapshot().workspace?.mailboxes[0]?.unread).toBe(1);
  });

  it("removes rows immediately and restores original order on rejection", () => {
    const state = new OptimisticMessageState();
    state.acceptWorkspace(populated(), "inbox");
    const token = begin(state, {
      messageIds: [id.message("message-a")],
      type: "archive",
    });

    expect(state.snapshot().workspace?.messages.items.map(({ id: messageId }) => messageId))
      .toEqual(["message-b"]);
    expect(state.snapshot().workspace?.messages.total).toBe(1);
    state.settle(token!, []);
    expect(state.snapshot().workspace?.messages.items.map(({ id: messageId }) => messageId))
      .toEqual(["message-a", "message-b"]);
    expect(state.snapshot().workspace?.messages.total).toBe(2);
  });

  it("projects source and destination counters and rolls back a failed move", () => {
    const state = new OptimisticMessageState();
    state.acceptWorkspace(populatedWithDestinations(), "inbox");
    const token = begin(state, {
      destinationMailboxId: id.mailbox("custom"),
      messageIds: [id.message("message-a"), id.message("message-b")],
      sourceMailboxId: inboxId,
      type: "move",
    });

    expect(state.snapshot().workspace?.mailboxes.map(({ total, unread }) =>
      [total, unread])).toEqual([[0, 0], [4, 1], [3, 0], [7, 4]]);
    state.settle(token!, [id.message("message-a")]);
    expect(state.snapshot().workspace?.mailboxes.map(({ total, unread }) =>
      [total, unread])).toEqual([[1, 1], [4, 1], [3, 0], [6, 3]]);
  });

  it("projects role destinations for archive and destroy", () => {
    const state = new OptimisticMessageState();
    state.acceptWorkspace(populatedWithDestinations(), "inbox");
    const archive = begin(state, {
      messageIds: [id.message("message-a")], type: "archive",
    });
    expect(state.snapshot().workspace?.mailboxes.map(({ total, unread }) =>
      [total, unread])).toEqual([[1, 1], [5, 2], [3, 0], [5, 2]]);
    state.settle(archive!, [id.message("message-a")]);

    const destroyState = new OptimisticMessageState();
    const archiveWorkspace = populatedWithDestinations();
    destroyState.acceptWorkspace({
      ...archiveWorkspace,
      messages: {
        ...archiveWorkspace.messages,
        items: archiveWorkspace.messages.items.map((item) => ({
          ...item, mailboxIds: [id.mailbox("archive")],
        })),
      },
    }, "archive");
    const destroy = destroyState.begin({
      activeMailboxId: id.mailbox("archive"),
      mutation: {
        mailboxId: id.mailbox("archive"),
        messageIds: [id.message("message-a")],
        type: "destroy",
      },
      sessionScope: "scope-a",
      viewKey: "archive",
    });
    expect(destroyState.snapshot().workspace?.mailboxes[1]?.total).toBe(4);
    destroyState.settle(destroy!, [id.message("message-a")]);
    expect(destroyState.snapshot().workspace?.mailboxes[1]?.total).toBe(3);
  });

  it("keeps an ambiguous projection until authoritative refresh", () => {
    const state = new OptimisticMessageState();
    state.acceptWorkspace(populated(), "inbox");
    const token = begin(state, {
      messageIds: [id.message("message-a")],
      type: "set-starred",
      value: true,
    });
    state.markUnconfirmed(token!);

    expect(state.snapshot().workspace?.messages.items[0]?.isStarred).toBe(true);
    expect(state.snapshot().isMessageMutationBusy).toBe(false);
    state.acceptWorkspace(populated(), "inbox");
    expect(state.snapshot().workspace?.messages.items[0]?.isStarred).toBe(false);
  });

  it("lets a newer intent supersede an unconfirmed projection", () => {
    const state = new OptimisticMessageState();
    state.acceptWorkspace(populated(), "inbox");
    const first = begin(state, {
      messageIds: [id.message("message-a")], type: "set-starred", value: true,
    });
    state.markUnconfirmed(first!);
    const second = begin(state, {
      messageIds: [id.message("message-a")], type: "set-starred", value: false,
    });
    state.settle(second!, [id.message("message-a")]);

    expect(state.snapshot().workspace?.messages.items[0]?.isStarred).toBe(false);
  });

  it("does not reopen an old reader after the user selects another message", () => {
    const state = new OptimisticMessageState();
    state.acceptWorkspace(populated(), "inbox");
    state.commitMessage(message("message-a") as MessageDetail, "scope-a");
    const token = begin(state, {
      messageIds: [id.message("message-a")],
      type: "archive",
    });
    state.commitMessage(message("message-b") as MessageDetail, "scope-a");
    state.settle(token!, []);

    expect(state.snapshot().selectedMessage?.id).toBe("message-b");
  });

  it("keeps irreversible destroy confirmation-first", () => {
    const state = new OptimisticMessageState();
    state.acceptWorkspace(populated(), "inbox");
    const token = begin(state, {
      mailboxId: inboxId,
      messageIds: [id.message("message-a")],
      type: "destroy",
    });

    expect(state.snapshot().workspace?.messages.items).toHaveLength(2);
    state.settle(token!, [id.message("message-a")]);
    expect(state.snapshot().workspace?.messages.items).toHaveLength(1);
  });
});
